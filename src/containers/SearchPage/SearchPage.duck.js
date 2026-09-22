import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { createImageVariantConfig } from '../../util/sdkLoader';
import { isErrorUserPendingApproval, isForbiddenError, storableError } from '../../util/errors';
import { convertUnitToSubUnit, unitDivisor } from '../../util/currency';
import {
  parseDateFromISO8601,
  getExclusiveEndDate,
  addTime,
  subtractTime,
  daysBetween,
  getStartOf,
} from '../../util/dates';
import { constructQueryParamName, isOriginInUse } from '../../util/search';
import { hasPermissionToViewData, isUserAuthorized } from '../../util/userHelpers';
import { parse } from '../../util/urlHelpers';

import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { fetchListingShuffleSettings } from '../../util/api';

// Pagination page size might need to be dynamic on responsive page layouts
// Current design has max 3 columns 12 is divisible by 2 and 3
// So, there's enough cards to fill all columns on full pagination pages
const RESULT_PAGE_SIZE = 24;

// ---- Daily shuffle -------------------------------------------------------
// When enabled, the default browse order (no explicit sort + no keyword search)
// is a per-day random order, backed by the listing metadata field `sortRandom`
// (re-randomized by the shuffle-listings job). Whether it's active is an admin
// setting (Admin > Listing Shuffle), read here with a short-lived cache so the
// search path doesn't fetch it on every query.
//
// Prerequisites before turning it on in the admin panel, otherwise the default
// search will error on an unknown sort field:
//   1. Register the search schema (one-time, for dev + live marketplaces):
//        flex-cli search set --key sortRandom --type long --scope metadata -m <marketplace>
//   2. Seed values by running the job once: `yarn shuffle-listings`
const DAILY_SHUFFLE_SORT = 'meta_sortRandom';
const SHUFFLE_SETTING_TTL_MS = 60 * 1000;
// SSR renders the browse page before the browser ever runs, and the initial
// page state is serialized into the HTML rather than re-fetched on hydration.
// So if the setting can't be read during SSR, a fresh page load is stuck with
// the API's default order no matter what the toggle says — only client-side
// navigations would shuffle. Hence the server-side path below.
const SSR_SETTING_TIMEOUT_MS = 2000;
let shuffleSettingCache = { value: false, expiresAt: 0 };
let shuffleSettingInFlight = null;

// `request()` in util/api goes through window.fetch, which doesn't exist during
// SSR. The shuffle setting is public, unauthenticated data, so SSR can fetch it
// straight from our own API with an absolute URL instead. Timed out hard: a
// hanging request here would hang the render.
const fetchShuffleSettingForSSR = () => {
  const rootURL = process.env.REACT_APP_MARKETPLACE_ROOT_URL;
  if (!rootURL || typeof fetch !== 'function') {
    return Promise.resolve(false);
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), SSR_SETTING_TIMEOUT_MS) : null;

  return fetch(`${rootURL.replace(/\/$/, '')}/api/listing-shuffle-settings`, {
    ...(controller ? { signal: controller.signal } : {}),
  })
    .then(res => (res.ok ? res.json() : null))
    .then(settings => !!settings?.enabled)
    .catch(() => false)
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
};

const getDailyShuffleEnabled = () => {
  const now = Date.now();
  if (now < shuffleSettingCache.expiresAt) {
    return Promise.resolve(shuffleSettingCache.value);
  }
  if (shuffleSettingInFlight) {
    return shuffleSettingInFlight;
  }
  const fetchSetting =
    typeof window === 'undefined' ? fetchShuffleSettingForSSR() : fetchListingShuffleSettings();
  shuffleSettingInFlight = fetchSetting
    .then(settings => {
      const value = typeof settings === 'boolean' ? settings : !!settings?.enabled;
      shuffleSettingCache = { value, expiresAt: Date.now() + SHUFFLE_SETTING_TTL_MS };
      shuffleSettingInFlight = null;
      return value;
    })
    .catch(() => {
      // Endpoint error: fall back to "off" so search always works; cache
      // briefly to avoid hammering on repeated failures.
      shuffleSettingCache = { value: false, expiresAt: Date.now() + SHUFFLE_SETTING_TTL_MS };
      shuffleSettingInFlight = null;
      return false;
    });
  return shuffleSettingInFlight;
};

// ================ Helper Functions ================ //

const resultIds = data => {
  const listings = data.data;
  return listings
    .filter(l => !l.attributes.deleted && l.attributes.state === 'published')
    .map(l => l.id);
};

// ================ Async Thunks ================ //

/////////////////////
// Search Listings //
/////////////////////
const searchListingsPayloadCreator = async ({ searchParams, config }, thunkAPI) => {
  const { dispatch, rejectWithValue, extra: sdk } = thunkAPI;
  // SearchPage can enforce listing query to only those listings with valid listingType
  // NOTE: this only works if you have set 'enum' type search schema to listing's public data fields
  //       - listingType
  //       Same setup could be expanded to 2 other extended data fields:
  //       - transactionProcessAlias
  //       - unitType
  //       ...and then turned enforceValidListingType config to true in configListing.js
  // Read More:
  // https://www.sharetribe.com/docs/how-to/manage-search-schemas-with-flex-cli/#adding-listing-search-schemas
  const searchValidListingTypes = (listingTypes, listingTypePathParam, isListingTypeVariant) => {
    return isListingTypeVariant
      ? {
          pub_listingType: listingTypePathParam,
        }
      : config.listing.enforceValidListingType
      ? {
          pub_listingType: listingTypes.map(l => l.listingType),
          // pub_transactionProcessAlias: listingTypes.map(l => l.transactionType.alias),
          // pub_unitType: listingTypes.map(l => l.transactionType.unitType),
        }
      : {};
  };

  const constructCategoryPropertiesForAPI = (queryParamPrefix, categories, level, params) => {
    const levelKey = `${queryParamPrefix}${level}`;
    const levelValue =
      typeof params?.[levelKey] !== 'undefined' ? `${params?.[levelKey]}` : undefined;
    const foundCategory = categories.find(cat => cat.id === levelValue);
    const subcategories = foundCategory?.subcategories || [];
    // Note: we might need to prepare nested categories too: categoryLevel1, categoryLevel2, categoryLevel3
    return foundCategory && subcategories.length > 0
      ? {
          [levelKey]: levelValue,
          ...constructCategoryPropertiesForAPI(queryParamPrefix, subcategories, level + 1, params),
        }
      : foundCategory
      ? { [levelKey]: levelValue }
      : {};
  };

  /**
   * Category filter params are prepared here. We omit invalid category names.
   * I.e. params that are not part of the currently configured category tree.
   *
   * @param {string} paramName - The name of the parameter to prepare.
   * @param {Object} params - The search params object.
   * @returns {Object} The prepared parameter object.
   */
  const prepareCategoryParams = (paramName, params) => {
    const categoryConfig = config.search.defaultFilters?.find(f => f.schemaType === 'category');
    const categories = config.categoryConfiguration.categories;
    const { key, scope } = categoryConfig || {};
    const categoryParamPrefix = constructQueryParamName(key, scope);
    return paramName.startsWith(categoryParamPrefix)
      ? constructCategoryPropertiesForAPI(categoryParamPrefix, categories, 1, params)
      : {};
  };

  const constructIntegerRangePropertyForAPI = (queryParamPrefix, params) => {
    const integerValue = params?.[queryParamPrefix];
    const [min, max] = integerValue ? integerValue.split(',') : [];
    // NOTE: long filter needs exclusive max value on API side
    const inclusiveMin = Number.parseInt(min, 10);
    const exclusiveMax = Number.parseInt(max, 10) + 1;

    // NOTE: currently we don't validate the range values against the integer range config,
    // but we might want to do that in the future.

    return Number.isInteger(inclusiveMin) && Number.isInteger(exclusiveMax)
      ? { [queryParamPrefix]: [inclusiveMin, exclusiveMax].join(',') }
      : {};
  };

  /**
   * Integer range filter values are converted to API params of type 'long'.
   *
   * The range end must be exclusive. E.g. 1000,2000 -> 1000,2001
   *
   * NOTE: currently we don't validate the range values against the integer range config,
   * but we might want to do that in the future.
   *
   * @param {string} paramName - The name of the parameter to prepare.
   * @param {Object} params - The search params object.
   * @returns {Object} The prepared parameter object.
   */
  const prepareIntegerRangeParam = (paramName, params) => {
    const integerRangeConfig = config.listing.listingFields?.find(f => f.schemaType === 'long');
    const { key, scope } = integerRangeConfig || {};
    const integerParamPrefix = constructQueryParamName(key, scope);
    return paramName.startsWith(integerParamPrefix)
      ? constructIntegerRangePropertyForAPI(integerParamPrefix, params)
      : {};
  };

  // This function goes through given params and if there's a specific handler for the parameter type,
  // it calls the handler to prepare the property for API.
  // Otherwise, it just passes the param through.
  const prepareAPIParams = (params, paramHandlers) => {
    const pickedKeys = Object.entries(params).reduce((picked, [k, v]) => {
      const preparedParams = paramHandlers.reduce((picked, fn) => {
        return { ...picked, ...fn(k, params) };
      }, {});

      // If the param is not handled by any of the handlers, we pass it through.
      const currentParam = Object.keys(preparedParams).length > 0 ? preparedParams : { [k]: v };

      return { ...picked, ...currentParam };
    }, {});

    return pickedKeys;
  };

  const priceSearchParams = priceParam => {
    const inSubunits = value => convertUnitToSubUnit(value, unitDivisor(config.currency));
    const values = priceParam ? priceParam.split(',') : [];
    return priceParam && values.length === 2
      ? {
          price: [inSubunits(values[0]), inSubunits(values[1]) + 1].join(','),
        }
      : {};
  };

  const datesSearchParams = datesParam => {
    const searchTZ = 'Etc/UTC';
    const datesFilter = config.search.defaultFilters.find(f => f.key === 'dates');
    const values = datesParam ? datesParam.split(',') : [];
    const hasValues = datesFilter && datesParam && values.length === 2;
    const { dateRangeMode, availability } = datesFilter || {};
    const isNightlyMode = dateRangeMode === 'night';
    const isEntireRangeAvailable = availability === 'time-full';

    // SearchPage need to use a single time zone but listings can have different time zones
    // We need to expand/prolong the time window (start & end) to cover other time zones too.
    //
    // NOTE: you might want to consider changing UI so that
    //   1) location is always asked first before date range
    //   2) use some 3rd party service to convert location to time zone (IANA tz name)
    //   3) Make exact dates filtering against that specific time zone
    //   This setup would be better for dates filter,
    //   but it enforces a UX where location is always asked first and therefore configurability
    const getProlongedStart = date => subtractTime(date, 14, 'hours', searchTZ);
    const getProlongedEnd = date => addTime(date, 12, 'hours', searchTZ);

    const startDate = hasValues ? parseDateFromISO8601(values[0], searchTZ) : null;
    const endRaw = hasValues ? parseDateFromISO8601(values[1], searchTZ) : null;
    const endDate =
      hasValues && isNightlyMode
        ? endRaw
        : hasValues
        ? getExclusiveEndDate(endRaw, searchTZ)
        : null;

    const today = getStartOf(new Date(), 'day', searchTZ);
    const possibleStartDate = subtractTime(today, 14, 'hours', searchTZ);
    const hasValidDates =
      hasValues &&
      startDate.getTime() >= possibleStartDate.getTime() &&
      startDate.getTime() <= endDate.getTime();

    const dayCount = isEntireRangeAvailable ? daysBetween(startDate, endDate) : 1;
    const day = 1440;
    const hour = 60;
    // When entire range is required to be available, we count minutes of included date range,
    // but there's a need to subtract one hour due to possibility of daylight saving time.
    // If partial range is needed, then we just make sure that the shortest time unit supported
    // is available within the range.
    // You might want to customize this to match with your time units (e.g. day: 1440 - 60)
    const minDuration = isEntireRangeAvailable ? dayCount * day - hour : hour;
    return hasValidDates
      ? {
          start: getProlongedStart(startDate),
          end: getProlongedEnd(endDate),
          // Availability can be time-full or time-partial.
          // However, due to prolonged time window, we need to use time-partial.
          availability: 'time-partial',
          // minDuration uses minutes
          minDuration,
        }
      : {};
  };

  const stockFilters = datesMaybe => {
    const hasDatesFilterInUse = Object.keys(datesMaybe).length > 0;

    // If dates filter is not in use,
    //   1) Add minStock filter with default value (1)
    //   2) Add relaxed stockMode: "match-undefined"
    // The latter is used to filter out all the listings that explicitly are out of stock,
    // but keeps bookable and inquiry listings.
    return hasDatesFilterInUse ? {} : { minStock: 1, stockMode: 'match-undefined' };
  };

  const seatsSearchParams = (seats, datesMaybe) => {
    const seatsFilter = config.search.defaultFilters.find(f => f.key === 'seats');
    const hasDatesFilterInUse = Object.keys(datesMaybe).length > 0;

    // Seats filter cannot be applied without dates
    return hasDatesFilterInUse && seatsFilter ? { seats } : {};
  };

  const {
    perPage,
    price,
    dates,
    seats,
    sort,
    mapSearch,
    listingTypePathParam,
    isListingTypeVariant,
    ...restOfParams
  } = searchParams;
  // The params related to default filters are prepared one-by-one
  // We could consider moving them to the prepareAPIParams function too.
  const priceMaybe = priceSearchParams(price);
  const datesMaybe = datesSearchParams(dates);
  const stockMaybe = stockFilters(datesMaybe);
  const seatsMaybe = seatsSearchParams(seats, datesMaybe);
  // Sort handling:
  // - keyword relevance sort: omit `sort` so the API orders by relevance
  // - explicit user sort: pass it through
  // - no explicit sort + daily shuffle enabled + not a keyword search: default
  //   to the per-day random order (meta_sortRandom)
  // - otherwise: pass `sort` through (undefined => API default, newest first)
  const hasKeywordSearch = !!restOfParams.keywords;
  const isRelevanceSort = sort === config.search.sortConfig.relevanceKey;
  const isExplicitSort = sort && !isRelevanceSort;
  // Only consult the admin shuffle setting when we'd otherwise fall back to the
  // API's default order (no explicit sort, not a keyword/relevance search).
  const useDailyShuffle = !sort && !hasKeywordSearch ? await getDailyShuffleEnabled() : false;
  const sortMaybe = isRelevanceSort
    ? {}
    : isExplicitSort
    ? { sort }
    : useDailyShuffle
    ? { sort: DAILY_SHUFFLE_SORT }
    : { sort };

  const params = {
    // The params that are related to listing fields and categories are prepared here.
    // We add handler functions that check category and integer range configurations.
    // - With category params, we essentially just omit invalid category names.
    //   I.e. params that are not part of the currently configured category tree.
    // - With integer range params, we prepare the property for API.
    //   I.e. the range end must be exclusive. E.g. 1000,2000 -> 1000,2001
    // Note: invalid independent search params are still passed through
    ...prepareAPIParams(restOfParams, [prepareCategoryParams, prepareIntegerRangeParam]),
    // If the search page variant is of type /s/:listingType, this sets the pub_listingType
    // query parameter to the value of the listing type path parameter. The ordering matters here,
    // since this value overrides any possible pub_listingType value coming from query parameters
    // i.e. the previous row.
    //
    // Only one value is currently supported in pub_listingType – if you want to support e.g.
    // /s/:listingType?pub_listingType=[otherListingType] => pub_listingType=listingType,otherListingType,
    // you'll need to customize a logic that merges the query param and path param values.
    ...searchValidListingTypes(
      config.listing.listingTypes,
      listingTypePathParam,
      isListingTypeVariant
    ),
    ...priceMaybe,
    ...datesMaybe,
    ...stockMaybe,
    ...seatsMaybe,
    ...sortMaybe,
    perPage,
  };

  return sdk.listings
    .query(params)
    .then(response => {
      const listingFields = config?.listing?.listingFields;
      const sanitizeConfig = { listingFields };

      dispatch(addMarketplaceEntities(response, sanitizeConfig));
      return response;
    })
    .catch(e => {
      const error = storableError(e);
      if (!(isErrorUserPendingApproval(error) || isForbiddenError(error))) {
        return rejectWithValue(error);
      }
      return rejectWithValue(error);
    });
};

export const searchListings = createAsyncThunk(
  'SearchPage/searchListings',
  searchListingsPayloadCreator
);

///////////////////
// Category rows //
///////////////////
// The default browse view (no filters, no keywords, no sort, page 1) renders one
// horizontally scrolling row per top-level category instead of a flat grid.
// Each row is its own listings query so every row is populated independently —
// grouping a single page of results client-side would leave rows empty or
// lopsided depending on what happened to land on page 1.
const CATEGORY_ROW_PAGE_SIZE = 12;

const searchCategoryRowsPayloadCreator = async (
  { categoryIds = [], searchParams, config },
  thunkAPI
) => {
  const { dispatch, extra: sdk } = thunkAPI;
  const sanitizeConfig = { listingFields: config?.listing?.listingFields };

  // A row only shows the first handful of listings in its category, and the
  // API's default order is newest first — so the vendors who joined earliest
  // were permanently at the far end of every row. The daily shuffle gives each
  // listing a turn near the front, and it is the same admin setting and the
  // same sort the flat grid already uses, so the two views agree.
  const useDailyShuffle = await getDailyShuffleEnabled();
  const sortMaybe = useDailyShuffle ? { sort: DAILY_SHUFFLE_SORT } : {};

  const responses = await Promise.all(
    categoryIds.map(id =>
      sdk.listings
        .query({
          ...searchParams,
          ...sortMaybe,
          pub_categoryLevel1: id,
          perPage: CATEGORY_ROW_PAGE_SIZE,
        })
        .then(response => {
          dispatch(addMarketplaceEntities(response, sanitizeConfig));
          return { id, ids: resultIds(response.data) };
        })
        // A single failing category must not blank the whole page — that row
        // just renders empty and gets skipped.
        .catch(() => ({ id, ids: [] }))
    )
  );

  return responses.reduce((acc, { id, ids }) => ({ ...acc, [id]: ids }), {});
};

export const searchCategoryRows = createAsyncThunk(
  'SearchPage/searchCategoryRows',
  searchCategoryRowsPayloadCreator
);

// Category rows replace the flat grid only on an untouched browse view. As soon
// as the user filters, searches, sorts or pages, we go back to the flat grid so
// the result set the controls act on is the one being displayed.
// Params that don't narrow the result set, so they can be present while the view
// still counts as untouched.
const ROW_NEUTRAL_PARAMS = ['page', 'mapSearch'];

export const shouldShowCategoryRows = (queryParams = {}, page = 1) => {
  if (page > 1) {
    return false;
  }
  // Allowlist rather than a blocklist of known filter params: a keyword search
  // (`keywords`), a location search (`address` + `bounds`), a sort and every
  // extended-data filter all have to fall back to the flat grid, and which
  // param names exist is marketplace-specific because the filters come from
  // hosted config. Anything unrecognised therefore has to count as "the user
  // narrowed the search" — the failure mode of the opposite default is showing
  // the untouched browse rows next to a result count for a search the rows
  // don't reflect.
  return Object.keys(queryParams).every(key => ROW_NEUTRAL_PARAMS.includes(key));
};

// ================ Slice ================ //

const searchPageSlice = createSlice({
  name: 'SearchPage',
  initialState: {
    pagination: null,
    searchParams: null,
    searchInProgress: false,
    searchListingsError: null,
    currentPageResultIds: [],
    activeListingId: null,
    categoryRowResultIds: {},
    categoryRowsInProgress: false,
    categoryRowsError: null,
  },
  reducers: {
    setActiveListing: (state, action) => {
      state.activeListingId = action.payload;
    },
    // Row results outlive the search that fetched them: nothing else in this
    // slice clears them, so a filtered or keyword search would otherwise render
    // the previous browse view's rows underneath its own result count.
    clearCategoryRows: state => {
      state.categoryRowResultIds = {};
      state.categoryRowsInProgress = false;
      state.categoryRowsError = null;
    },
  },
  extraReducers: builder => {
    // Search Listings
    builder
      .addCase(searchListings.pending, (state, action) => {
        state.searchParams = action.meta.arg.searchParams;
        state.searchInProgress = true;
        state.searchListingsError = null;
      })
      .addCase(searchListings.fulfilled, (state, action) => {
        state.currentPageResultIds = resultIds(action.payload.data);
        state.pagination = action.payload.data.meta;
        state.searchInProgress = false;
      })
      .addCase(searchListings.rejected, (state, action) => {
        // eslint-disable-next-line no-console
        console.error(action.payload);
        state.searchInProgress = false;
        state.searchListingsError = action.payload;
      });

    // Category rows
    builder
      .addCase(searchCategoryRows.pending, state => {
        state.categoryRowsInProgress = true;
        state.categoryRowsError = null;
      })
      .addCase(searchCategoryRows.fulfilled, (state, action) => {
        state.categoryRowResultIds = action.payload;
        state.categoryRowsInProgress = false;
      })
      .addCase(searchCategoryRows.rejected, (state, action) => {
        state.categoryRowsInProgress = false;
        state.categoryRowsError = action.payload;
        state.categoryRowResultIds = {};
      });
  },
});

// Export the action creator
export const { setActiveListing, clearCategoryRows } = searchPageSlice.actions;

export default searchPageSlice.reducer;

// ================ Load data ================ //

export const loadData = (params, search, config) => (dispatch, getState, sdk) => {
  // In private marketplace mode, this page won't fetch data if the user is unauthorized
  const { listingType: listingTypePathParam } = params || {};
  const state = getState();
  const currentUser = state.user?.currentUser;
  const isAuthorized = currentUser && isUserAuthorized(currentUser);
  const hasViewingRights = currentUser && hasPermissionToViewData(currentUser);
  const isPrivateMarketplace = config.accessControl.marketplace.private === true;
  const canFetchData =
    !isPrivateMarketplace || (isPrivateMarketplace && isAuthorized && hasViewingRights);
  if (!canFetchData) {
    return Promise.resolve();
  }

  const queryParams = parse(search, {
    latlng: ['origin'],
    latlngBounds: ['bounds'],
  });

  const { page = 1, address, origin, ...rest } = queryParams;
  const originMaybe = isOriginInUse(config) && origin ? { origin } : {};

  const listingTypeVariantMaybe = listingTypePathParam
    ? { listingTypePathParam, isListingTypeVariant: true }
    : {};

  const {
    aspectWidth = 1,
    aspectHeight = 1,
    variantPrefix = 'listing-card',
  } = config.layout.listingImage;
  const aspectRatio = aspectHeight / aspectWidth;

  // Field selection shared by the flat grid query and the per-category row
  // queries, so cards render identically in both layouts.
  const listingQueryFields = {
    include: ['author', 'images'],
    'fields.listing': [
      'title',
      'geolocation',
      'price',
      'deleted',
      'state',
      'publicData.listingType',
      'publicData.transactionProcessAlias',
      'publicData.unitType',
      'publicData.cardStyle',
      // These help rendering of 'purchase' listings,
      // when transitioning from search page to listing page
      'publicData.pickupEnabled',
      'publicData.shippingEnabled',
      'publicData.priceVariationsEnabled',
      'publicData.priceVariants',
    ],
    'fields.user': ['profile.displayName', 'profile.abbreviatedName'],
    'fields.image': [
      'variants.scaled-small',
      'variants.scaled-medium',
      `variants.${variantPrefix}`,
      `variants.${variantPrefix}-2x`,
    ],
    ...createImageVariantConfig(`${variantPrefix}`, 400, aspectRatio),
    ...createImageVariantConfig(`${variantPrefix}-2x`, 800, aspectRatio),
    'limit.images': 1,
  };

  const searchListingsCall = searchListings({
    searchParams: {
      ...rest,
      ...originMaybe,
      ...listingTypeVariantMaybe,
      page,
      perPage: RESULT_PAGE_SIZE,
      ...listingQueryFields,
    },
    config,
  });

  // On an untouched browse view, also fetch one page per top-level category for
  // the horizontal rows. Runs alongside the flat grid query rather than instead
  // of it: the grid data still backs the result count in the panel header, and
  // it's already there if the user starts filtering.
  const categoryIds = (config.categoryConfiguration?.categories || []).map(c => c.id);
  // queryParams, not `rest`: `address` and `origin` are destructured out above,
  // and a location search that only produced an address would otherwise read as
  // an untouched browse view.
  const wantsCategoryRows = shouldShowCategoryRows(queryParams, page) && categoryIds.length > 0;

  if (!wantsCategoryRows) {
    dispatch(clearCategoryRows());
    return dispatch(searchListingsCall);
  }

  // Row queries go straight to sdk.listings.query, so unlike the grid call they
  // need real API params — `listingTypePathParam` is an internal marker that the
  // searchListings payload creator translates, and it would be rejected here.
  const rowListingTypeMaybe = listingTypePathParam
    ? { pub_listingType: listingTypePathParam }
    : {};
  // Keep rows inside the same map area the grid is searching.
  const boundsMaybe = rest.bounds ? { bounds: rest.bounds } : {};

  const categoryRowsCall = searchCategoryRows({
    categoryIds,
    searchParams: {
      ...originMaybe,
      ...boundsMaybe,
      ...rowListingTypeMaybe,
      // Rows mirror the grid's stock handling so sold-out produce doesn't
      // surface in a row that the grid would have filtered out.
      minStock: 1,
      stockMode: 'match-undefined',
      ...listingQueryFields,
    },
    config,
  });

  return Promise.all([dispatch(searchListingsCall), dispatch(categoryRowsCall)]);
};
