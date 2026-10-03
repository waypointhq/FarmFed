import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

import PromoList from './PromoList';
import PromoForm from './PromoForm';
import PromoDetail from './PromoDetail';
import CustomerPromos from './CustomerPromos';
import GiftModal from './GiftModal';
import { usePromoT } from './shared';

import css from './PromotionsTab.module.css';

const TOAST_MS = 4000;

/**
 * Admin Promotions: free-delivery promos and gifts. Which screen shows is
 * kept in the URL (?promo=<id>|new, &edit=1, ?customer=<id>) so back/forward
 * and refresh work.
 */
const PromotionsTab = () => {
  const t = usePromoT();
  const location = useLocation();
  const history = useHistory();
  const params = new URLSearchParams(location.search);
  const promoParam = params.get('promo');
  const editing = params.get('edit') === '1';
  const customerParam = params.get('customer');

  const [gift, setGift] = useState(null);
  const [toast, setToast] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const toastTimer = useRef(null);

  const go = updates => {
    const next = new URLSearchParams(location.search);
    ['promo', 'edit', 'customer'].forEach(key => next.delete(key));
    Object.entries(updates).forEach(([key, value]) => {
      if (value != null) next.set(key, value);
    });
    history.push({ pathname: location.pathname, search: `?${next.toString()}` });
  };

  const showToast = useCallback(message => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const handleGiftSent = (results, { emailRequested } = {}) => {
    setGift(null);
    setRefreshKey(k => k + 1);
    const names = results.map(r => r.name).filter(Boolean);
    const emailFailed = emailRequested && results.some(r => !r.emailSent);
    const sentTo =
      results.length === 1 && names[0]
        ? t('gift.sentToOne', { name: names[0] })
        : t('gift.sentToMany', { count: results.length });
    showToast(emailFailed ? `${sentTo} ${t('gift.emailNotSent')}` : sentTo);
  };

  let screen;
  if (customerParam) {
    screen = (
      <CustomerPromos
        userId={customerParam}
        refreshKey={refreshKey}
        onBack={() => go({})}
        onGift={customer => setGift({ customers: [customer] })}
        onOpenPromo={id => go({ promo: id })}
        onToast={showToast}
      />
    );
  } else if (promoParam === 'new' || (promoParam && editing)) {
    const promoId = promoParam === 'new' ? null : promoParam;
    screen = (
      <PromoForm
        key={promoParam}
        promoId={promoId}
        onSaved={promo => {
          showToast(t('saved', { code: promo.code }));
          go({ promo: promo.id });
        }}
        onCancel={() => go(promoId ? { promo: promoId } : {})}
      />
    );
  } else if (promoParam) {
    screen = (
      <PromoDetail
        key={promoParam}
        promoId={promoParam}
        refreshKey={refreshKey}
        onBack={() => go({})}
        onEdit={() => go({ promo: promoParam, edit: '1' })}
        onGift={promo => setGift({ promoId: promo.id })}
        onOpenPromo={(id, edit) => go({ promo: id, edit: edit ? '1' : null })}
        onToast={showToast}
      />
    );
  } else {
    screen = (
      <PromoList
        onOpen={id => go({ promo: id })}
        onCreate={() => go({ promo: 'new' })}
        onGift={() => setGift({})}
        onOpenCustomer={id => go({ customer: id })}
      />
    );
  }

  return (
    <div className={css.root}>
      {screen}
      {gift ? (
        <GiftModal
          promoId={gift.promoId}
          customers={gift.customers}
          onClose={() => setGift(null)}
          onSent={handleGiftSent}
        />
      ) : null}
      {toast ? (
        <div className={css.toast} role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
};

export default PromotionsTab;
