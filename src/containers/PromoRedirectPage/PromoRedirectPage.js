import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { setAppliedPromoCode } from '../../util/promos';
import { NamedRedirect } from '../../components';

/**
 * /promo/:code — where the gift email's "Shop Now" lands. Remembers the code
 * so checkout applies it, then opens the shop.
 */
const PromoRedirectPage = () => {
  const { code } = useParams();
  const [ready, setReady] = useState(false);

  // localStorage only exists in the browser, so this waits for the client.
  useEffect(() => {
    setAppliedPromoCode(code);
    setReady(true);
  }, [code]);

  return ready ? <NamedRedirect name="SearchPage" /> : null;
};

export default PromoRedirectPage;
