import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { formatPromoDate, daysUntil, isExpiringSoon, setAppliedPromoCode } from '../../util/promos';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { pathByRouteName } from '../../util/routes';

import css from './PromoCard.module.css';

const IconCopy = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
    <rect
      x="9"
      y="9"
      width="11"
      height="11"
      rx="2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <path
      d="M5 15V6a2 2 0 0 1 2-2h9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * "1 left · Expires Oct 31", or an amber "Expires in 3 days" inside a week.
 */
const PromoMeta = ({ promo }) => {
  const soon = isExpiringSoon(promo.expiresAt);
  const days = daysUntil(promo.expiresAt);
  return (
    <span className={css.meta}>
      {promo.usesLeft != null ? (
        <FormattedMessage id="PromoCard.usesLeft" values={{ count: promo.usesLeft }} />
      ) : null}
      {promo.usesLeft != null && promo.expiresAt ? ' · ' : null}
      {promo.expiresAt ? (
        soon ? (
          <span className={css.expiringSoon}>
            <FormattedMessage id="PromoCard.expiresIn" values={{ count: days }} />
          </span>
        ) : (
          <FormattedMessage
            id="PromoCard.expires"
            values={{ date: formatPromoDate(promo.expiresAt) }}
          />
        )
      ) : null}
    </span>
  );
};

/**
 * One free-delivery promo, as the customer sees it. "Use Now" opens the shop
 * with the promo applied to the cart.
 *
 * @param {Object} props
 * @param {Object} props.promo { code, title, message, usesLeft, expiresAt, isNew }
 * @param {boolean} [props.showCode] show the code with a copy button (My Promos page)
 * @param {string} [props.className]
 */
const PromoCard = props => {
  const { promo, showCode = false, className } = props;
  const intl = useIntl();
  const history = useHistory();
  const routeConfiguration = useRouteConfiguration();
  const [copied, setCopied] = useState(false);

  const handleUseNow = () => {
    setAppliedPromoCode(promo.code);
    history.push(pathByRouteName('SearchPage', routeConfiguration));
  };

  const copyCode = () => {
    try {
      window.navigator.clipboard.writeText(promo.code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } catch (e) {
      // No clipboard access; the code is on screen to copy by hand.
    }
  };

  return (
    <div className={classNames(css.root, className)}>
      <div className={css.header}>
        <span className={css.title}>{promo.title || 'Free Delivery'}</span>
        {promo.isNew ? (
          <span className={css.newTag}>
            <FormattedMessage id="PromoCard.new" />
          </span>
        ) : null}
      </div>
      {promo.message ? <p className={css.message}>{promo.message}</p> : null}
      {showCode ? (
        <div className={css.codeRow}>
          <span className={css.code}>{promo.code}</span>
          <button
            type="button"
            className={css.copyButton}
            onClick={copyCode}
            aria-label={intl.formatMessage({ id: 'PromoCard.copyCode' })}
          >
            {copied ? <FormattedMessage id="PromoCard.copied" /> : <IconCopy />}
          </button>
        </div>
      ) : null}
      <div className={css.footer}>
        <PromoMeta promo={promo} />
        <button type="button" className={css.useNow} onClick={handleUseNow}>
          <FormattedMessage id="PromoCard.useNow" />
        </button>
      </div>
    </div>
  );
};

export default PromoCard;
