const crypto = require('crypto');

function createLeadParser({
  storage,
  products,
  extractPhone,
  extractRequestedProductCodes,
  normalizeText,
  deriveSessionState,
  STATES,
  pushLeadToSheet,
  sendTelegramAlert,
  trackEvent
}) {
  function cleanLeadPart(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/\s+(?:nhé|nhe|nha|ạ)$/i, '')
      .replace(/\s+(?:shop|ad|minh|mình|anh|chị|chi|em)\s*(?:ơi|oi)?$/i, '')
      .replace(/^[,:;\-\s]+|[,:;\-\s]+$/g, '')
      .trim();
  }

  const LEAD_PRONOUN_PATTERN = '(?:mình|minh|em|anh|chị|chi|tôi|toi)';
  const PHONE_LABEL_PATTERN = '(?:sđt|sdt|số\\s*điện\\s*thoại|so\\s*dien\\s*thoai|đt|dt|phone)';
  const NAME_LABEL_PATTERN = '(?:tên\\s*người\\s*nhận|ten\\s*nguoi\\s*nhan|người\\s*nhận|nguoi\\s*nhan|tên|ten)';
  const ADDRESS_LABEL_PATTERN = '(?:địa\\s*chỉ|dia\\s*chi|dc|ship\\s*về|ship\\s*ve|giao\\s*về|giao\\s*ve|nơi\\s*nhận|noi\\s*nhan|chỗ\\s*nhận|cho\\s*nhan)';
  const ANY_LEAD_LABEL_PATTERN = `(?:${PHONE_LABEL_PATTERN}|${NAME_LABEL_PATTERN}|${ADDRESS_LABEL_PATTERN})`;

  function stripLeadPrefixes(text) {
    return cleanLeadPart(text)
      .replace(new RegExp(`^(?:${LEAD_PRONOUN_PATTERN}\\s+)?${NAME_LABEL_PATTERN}\\s*(?:là|la|:)?\\s*`, 'i'), '')
      .replace(new RegExp(`^(?:${LEAD_PRONOUN_PATTERN}\\s+)?(?:là|la)\\s+`, 'i'), '')
      .replace(new RegExp(`^${ADDRESS_LABEL_PATTERN}\\s*(?:là|la|:)?\\s*`, 'i'), '')
      .trim();
  }

  function extractLabeledLeadValue(text, labelPattern) {
    const re = new RegExp(
      `(?:^|[\\s,;|+])${labelPattern}\\s*(?:là|la|:|-)?\\s*([\\s\\S]*?)(?=(?:[\\s,;|+]+${ANY_LEAD_LABEL_PATTERN}\\s*(?:là|la|:|-)?\\s*)|$)`,
      'i'
    );
    const match = String(text || '').match(re);
    return match ? cleanLeadPart(match[1]) : '';
  }

  function splitLabeledLeadFields(text) {
    const name = extractLabeledLeadValue(text, NAME_LABEL_PATTERN);
    const address = extractLabeledLeadValue(text, ADDRESS_LABEL_PATTERN);
    if (!name && !address) return null;
    return { name, address };
  }

  function prefixedLeadPart(text) {
    const raw = cleanLeadPart(text);
    const labeled = splitLabeledLeadFields(raw);
    if (labeled) return labeled;

    const name = raw.match(/^(?:tên người nhận|ten nguoi nhan|người nhận|nguoi nhan|tên|ten)\s*(?:là|la|:)?\s*(.+)$/i);
    if (name) return { name: cleanLeadPart(name[1]) };

    const address = raw.match(/^(?:địa chỉ|dia chi|dc|ship về|ship ve|giao về|giao ve)\s*(?:là|la|:)?\s*(.+)$/i);
    if (address) return { address: cleanLeadPart(address[1]) };

    return null;
  }

  function splitExplicitOrderFields(text) {
    const raw = cleanLeadPart(text);
    const labeled = splitLabeledLeadFields(raw);
    if (labeled) return labeled;

    const addressMatch = raw.match(/^(.*?)\b(?:và\s*)?(?:địa chỉ|dia chi|dc|ship về|ship ve|giao về|giao ve)\s*(?:là|la|:)?\s*(.+)$/i);
    if (!addressMatch) return null;

    const name = stripLeadPrefixes(addressMatch[1]).replace(/\b(và|va)$/i, '').trim();
    const address = cleanLeadPart(addressMatch[2]);
    if (!address) return null;

    return {
      name: cleanLeadPart(name),
      address
    };
  }

  function splitByPlusWithPhone(text) {
    const raw = cleanLeadPart(text);
    if (!/\+/.test(raw)) return null;

    const parts = raw
      .split(/\s*\+\s*/)
      .map(part => stripLeadPrefixes(part))
      .map(part => cleanLeadPart(part))
      .filter(Boolean);

    if (parts.length < 2) return null;

    const phoneIdx = parts.findIndex(part => Boolean(extractPhone(part)));
    if (phoneIdx < 0) return null;

    const name = cleanLeadPart(parts.slice(0, phoneIdx).join(' '));
    const address = cleanLeadPart(parts.slice(phoneIdx + 1).join(', '));
    return { name, address };
  }

  function findAddressStart(text) {
    const normalized = normalizeText(text);
    const keywordIndex = normalized.search(/\b(so|nha|ngo|ngach|hem|kiet|duong|thon|xom|ap|xa|phuong|huyen|quan|tinh|tp|thanh pho|ho chi minh|ha noi|sai gon|bac ninh|hai phong|da nang)\b/i);
    const numberMatch = normalized.match(/(?:^|\s)(?:so\s*)?\d+[a-z]?(?:[/-]\d+[a-z]?)?(?=\s+\S{2,})/i);
    const numberIndex = numberMatch
      ? numberMatch.index + (/^\s/.test(numberMatch[0]) ? 1 : 0)
      : -1;
    const indexes = [keywordIndex, numberIndex].filter(index => index >= 0);
    return indexes.length ? Math.min(...indexes) : -1;
  }

  function splitRestNameAndAddress(text) {
    const rest = stripLeadPrefixes(text);
    if (!rest) return { name: '', address: '' };

    const commaParts = rest
      .split(/[,;]+/)
      .map(part => stripLeadPrefixes(part))
      .filter(Boolean);
    if (commaParts.length >= 2) {
      return {
        name: commaParts[0],
        address: cleanLeadPart(commaParts.slice(1).join(', '))
      };
    }

    const addressStart = findAddressStart(rest);
    if (addressStart > 0) {
      return {
        name: cleanLeadPart(rest.slice(0, addressStart)),
        address: cleanLeadPart(rest.slice(addressStart))
      };
    }
    if (addressStart === 0) {
      return { name: '', address: cleanLeadPart(rest) };
    }

    const parts = rest.split(/\s+/);
    if (parts.length <= 3) return { name: rest, address: '' };
    return {
      name: cleanLeadPart(parts.slice(0, 2).join(' ')),
      address: cleanLeadPart(parts.slice(2).join(' '))
    };
  }

  function splitNameAndAddress(text) {
    const labeled = splitLabeledLeadFields(text);
    if (labeled) return labeled;

    const plusFormat = splitByPlusWithPhone(text);
    if (plusFormat) return plusFormat;

    const phoneMatch = String(text || '').match(/(?:\+?84|0)\d{8,10}/);
    if (phoneMatch) {
      const beforePhone = stripLeadPrefixes(String(text).slice(0, phoneMatch.index));
      const afterPhone = stripLeadPrefixes(String(text).slice(phoneMatch.index + phoneMatch[0].length));
      const name = cleanLeadPart(beforePhone);
      const afterParts = splitRestNameAndAddress(afterPhone);
      if (name && (afterParts.address || afterPhone)) {
        return { name, address: afterParts.address || cleanLeadPart(afterPhone) };
      }
      if (name) return { name, address: '' };
      if (afterParts.name || afterParts.address) return afterParts;
    }

    const withoutPhone = String(text || '').replace(/(?:\+?84|0)\d{8,10}/g, ' ');
    const explicit = splitExplicitOrderFields(withoutPhone);
    if (explicit) return explicit;

    const prefixed = prefixedLeadPart(withoutPhone);
    if (prefixed) return { name: prefixed.name || '', address: prefixed.address || '' };

    const lines = withoutPhone
      .split(/\r?\n/)
      .map(line => stripLeadPrefixes(line))
      .filter(Boolean);

    if (lines.length >= 2) {
      return {
        name: lines[0],
        address: cleanLeadPart(lines.slice(1).join(', '))
      };
    }

    return splitRestNameAndAddress(lines[0] || withoutPhone);
  }

  function normalizeLeadTextField(text) {
    return cleanLeadPart(
      String(text || '')
        .replace(/(?:\+?84|0)\d{8,10}/g, ' ')
        .replace(/\s*\+\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
    );
  }

  function looksLikeShippingAddressPart(text) {
    const cleaned = cleanLeadPart(stripLeadPrefixes(text));
    if (!cleaned) return false;
    if (findAddressStart(cleaned) >= 0) return true;
    return /[,;]/.test(cleaned)
      && /\b(xa|phuong|huyen|quan|tinh|tp|thanh pho)\b/i.test(normalizeText(cleaned));
  }

  function extractAddressChangeText(userText, mentionedCode = '') {
    const raw = String(userText || '');
    const explicit = raw.match(new RegExp(
      `(?:đổi|doi|sửa|sua|cập\\s*nhật|cap\\s*nhat|chuyển|chuyen)\\s*(?:${ADDRESS_LABEL_PATTERN})\\s*(?:sang|thành|thanh|là|la|:)?\\s*(.+)$`,
      'i'
    ));
    if (explicit) return cleanLeadPart(explicit[1]);

    // Chỉ coi "đổi/sửa ... sang ..." là đổi địa chỉ khi phần sau thật sự giống địa chỉ.
    // Nếu câu có mã sản phẩm ("đổi sang mã 10") thì để luồng đổi mẫu xử lý.
    if (mentionedCode) return '';

    const broad = raw.match(/(?:đổi|doi|sửa|sua|cập\s*nhật|cap\s*nhat|chuyển|chuyen)\b[\s\S]*?\b(?:sang|thành|thanh|là|la|:)\s*(.+)$/i);
    if (!broad) return '';
    return looksLikeShippingAddressPart(broad[1]) ? cleanLeadPart(broad[1]) : '';
  }

  function isProductChangeText(text) {
    const t = normalizeText(text);
    return /\b(doi|sua|chuyen|cap\s*nhat)\b/.test(t)
      && (/\b(ma|mau|san\s*pham|sp)\b/.test(t) || /\bsang\b/.test(t));
  }

  function hasExistingOrderDraft(draft = {}) {
    return Boolean(
      draft.productCode
      || draft.phone
      || draft.name
      || draft.address
      || (Array.isArray(draft.cartItems) && draft.cartItems.length)
    );
  }

  function isCatalogProductCartItem(item = {}) {
    const code = String(item.code || '').trim().toUpperCase();
    const name = String(item.name || '').trim().toUpperCase();
    return /^MÃ\d+$/.test(code) || /^MÃ\d+$/.test(name);
  }

  function buildReplacementCartItems(draft = {}, productCode = '') {
    const code = String(productCode || '').trim().toUpperCase();
    if (!code) return [];

    const existing = Array.isArray(draft.cartItems) ? draft.cartItems : [];
    const previousProduct = existing.find(isCatalogProductCartItem);
    const productItem = {
      code,
      name: code,
      qty: Number(previousProduct?.qty || 1) || 1,
      variant: '',
      display: code
    };
    const extras = existing.filter(item => !isCatalogProductCartItem(item));
    return [productItem, ...extras];
  }

  /**
   * Khóa idempotent cho Google Sheet: retry webhook cùng tin nhắn → cùng key.
   * - Có mid (Meta): SHA-256(`fbmid:` + mid) — an toàn nhất, ổn định qua mọi lần retry.
   * - Không mid (hiếm, ví dụ postback): SHA-256 snapshot đơn + nội dung tin nhắn chuẩn hoá.
   */
  function buildSheetDedupeKey(senderId, messageId, userText) {
    const mid = String(messageId || '').trim();
    if (mid) {
      return crypto.createHash('sha256').update(`fbmid:${mid}`, 'utf8').digest('hex');
    }

    const draft = storage.getOrderDraft(senderId);
    const codeRaw = String(draft.productCode || storage.getLastProductCode(senderId) || '').trim();
    const fingerprint = [
      'nomid',
      senderId,
      normalizeText(String(userText || '')),
      draft.updatedAt || '',
      String(draft.name || '').trim(),
      String(draft.phone || '').trim(),
      String(draft.address || '').trim(),
      codeRaw
    ].join('\x1e');

    return crypto.createHash('sha256').update(fingerprint, 'utf8').digest('hex');
  }

  function normalizeCartForHash(cartItems = []) {
    return (Array.isArray(cartItems) ? cartItems : [])
      .map(item => ({
        code: String(item.code || '').trim().toUpperCase(),
        name: String(item.name || '').trim().toLowerCase(),
        qty: Number(item.qty || 1) || 1,
        variant: String(item.variant || '').trim().toLowerCase()
      }))
      .filter(item => item.code || item.name)
      .sort((a, b) => `${a.code}|${a.name}|${a.variant}`.localeCompare(`${b.code}|${b.name}|${b.variant}`));
  }

  function buildOrderStaffNotificationHash(orderDraft = {}, fallbackProductCode = '') {
    const payload = {
      cartItems: normalizeCartForHash(orderDraft.cartItems),
      productCode: String(orderDraft.productCode || fallbackProductCode || '').trim().toUpperCase(),
      name: normalizeText(String(orderDraft.name || '').trim()),
      phone: String(orderDraft.phone || '').replace(/\D/g, ''),
      address: normalizeText(String(orderDraft.address || '').trim())
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
  }

  /** Lead đồng bộ Sheet khi đơn CONFIRMED: cùng trường với orderDraft + mô tả sản phẩm nếu có. */
  function buildConfirmedSheetLead(senderId, opts = {}) {
    const { messageId = '', userText = '' } = opts;
    const draft = storage.getOrderDraft(senderId);
    const codeRaw = String(draft.productCode || storage.getLastProductCode(senderId) || '').trim();
    const codeUpper = codeRaw.toUpperCase();
    const product = products.find(p => String(p.code || '').toUpperCase() === codeUpper);
    const desc = String(product?.description || '').trim();
    const productInterest = product
      ? (desc ? `${product.code} — ${desc}` : String(product.code || ''))
      : codeRaw;
    const cartItems = Array.isArray(draft.cartItems) ? draft.cartItems : [];
    const cartText = cartItems.length
      ? cartItems.map(item => {
          const label = item.display
            || [item.qty && item.qty !== 1 ? item.qty : '', item.name || item.code, item.variant].filter(Boolean).join(' ');
          return label.trim();
        }).filter(Boolean).join(' + ')
      : '';

    return {
      dedupeKey: buildSheetDedupeKey(senderId, messageId, userText),
      senderId,
      name: String(draft.name || '').trim(),
      phone: String(draft.phone || '').trim(),
      address: String(draft.address || '').trim(),
      productCode: codeRaw,
      productInterest: cartText || productInterest,
      confirmedAt: new Date().toISOString()
    };
  }

  async function notifyStaffForReadyOrder(senderId, userText, opts = {}) {
    const draft = storage.getOrderDraft(senderId);
    if (deriveSessionState(senderId, draft) !== STATES.READY_TO_CONFIRM) return false;
    const hasProduct = Boolean(
      String(draft.productCode || storage.getLastProductCode(senderId) || '').trim()
      || (Array.isArray(draft.cartItems) && draft.cartItems.length)
    );
    if (!hasProduct) return false;

    const fallbackProductCode = storage.getLastProductCode(senderId);
    const hash = buildOrderStaffNotificationHash(draft, fallbackProductCode);
    const notified = storage.getOrderStaffNotification
      ? storage.getOrderStaffNotification(senderId)
      : {};
    if (notified.hash === hash) return false;

    const confirmedLead = buildConfirmedSheetLead(senderId, {
      messageId: opts.messageId || '',
      userText
    });
    const isUpdate = Boolean(notified.hash);
    trackEvent(senderId, isUpdate ? 'order_update_staff_notified' : 'order_staff_notified', userText, {
      productCode: confirmedLead.productCode || '',
      productInterest: confirmedLead.productInterest || '',
      previousNotifiedAt: notified.at || ''
    });
    console.log(`📤 Đơn đủ thông tin — gửi ${isUpdate ? 'cập nhật ' : ''}lead cho nhân viên (${senderId}).`);
    sendTelegramAlert({
      ...confirmedLead,
      text: isUpdate ? 'CẬP NHẬT ĐƠN ĐỦ THÔNG TIN' : 'ĐƠN ĐỦ THÔNG TIN - CHỜ KHÁCH OK'
    });
    if (storage.setOrderStaffNotification) {
      storage.setOrderStaffNotification(senderId, {
        hash,
        at: confirmedLead.confirmedAt
      });
    }
    return true;
  }

  function looksLikeBareCustomerName(text) {
    const raw = cleanLeadPart(text);
    const t = normalizeText(raw);
    if (!raw || raw.length < 2 || raw.length > 50) return false;
    if (raw.includes('?') || extractPhone(raw) || extractRequestedProductCodes(raw).length) return false;
    if (/\d/.test(raw)) return false;
    if (/^(?:ok|oke|oki|okay|vang|da|duoc|chot|lay|mua|dat|gui|ship|khong|ko|k)\b/.test(t)) return false;
    if (/(?:dia\s*chi|sdt|so\s*dien\s*thoai|ship|giao|xa|phuong|huyen|quan|tinh|tp|duong|thon|xom|ngo|ngach|hem|gel|ma|mau|shop|tu\s*van|gia|bao\s*nhieu)/.test(t)) return false;

    const words = raw.split(/\s+/).filter(Boolean);
    return words.length <= 5 && /[A-Za-zÀ-ỹ]/.test(raw);
  }

  function buildLeadDetails(userText, senderId) {
    const mentionedCode = extractRequestedProductCodes(userText)[0] || '';
    const productCode = mentionedCode || storage.getLastProductCode(senderId) || '';
    const phone = extractPhone(userText);
    const draft = storage.getOrderDraft(senderId);
    const addressChangeText = extractAddressChangeText(userText, mentionedCode);
    const hasLeadPrefix = new RegExp(
      `(?:^|\\n)\\s*(?:${LEAD_PRONOUN_PATTERN}\\s+)?(?:${NAME_LABEL_PATTERN}|${ADDRESS_LABEL_PATTERN})(?:\\s|:|$)`,
      'i'
    ).test(userText)
      || new RegExp(`(?:^|\\n)\\s*${LEAD_PRONOUN_PATTERN}\\s+(?:là|la)\\s+`, 'i').test(userText);
    const addressOnly = !phone && /[,;]/.test(userText) && /\b(xã|xa|phường|phuong|huyện|huyen|quận|quan|tỉnh|tinh|tp|thành phố|thanh pho)\b/i
      .test(normalizeText(userText));
    let parsed = addressChangeText
      ? { name: '', address: cleanLeadPart(addressChangeText) }
      : phone || hasLeadPrefix
      ? splitNameAndAddress(userText)
      : addressOnly
        ? { name: '', address: cleanLeadPart(stripLeadPrefixes(userText)) }
        : { name: '', address: '' };

    if (
      !parsed.name
      && !parsed.address
      && !phone
      && !mentionedCode
      && !draft.name
      && draft.phone
      && draft.address
      && looksLikeBareCustomerName(userText)
    ) {
      parsed = { name: cleanLeadPart(userText), address: '' };
    }

    const details = {
      productCode,
      phone,
      name: normalizeLeadTextField(parsed.name),
      address: normalizeLeadTextField(parsed.address)
    };
    if (mentionedCode && isProductChangeText(userText) && hasExistingOrderDraft(draft)) {
      details.cartItems = buildReplacementCartItems(draft, mentionedCode);
    }
    return details;
  }

  function shouldCaptureHandoffOrderUpdate(senderId, userText, leadDetails, previousDraft = {}) {
    const mentionedCode = extractRequestedProductCodes(userText)[0] || '';
    const previousCode = String(previousDraft.productCode || storage.getLastProductCode(senderId) || '').toUpperCase();
    const hasExistingOrder = Boolean(
      previousDraft.productCode
      || previousDraft.phone
      || previousDraft.name
      || previousDraft.address
      || (Array.isArray(previousDraft.cartItems) && previousDraft.cartItems.length)
    );
    const productChanged = mentionedCode
      && mentionedCode.toUpperCase() !== previousCode;

    if (!hasExistingOrder && !String(leadDetails.productCode || '').trim()) return false;

    return Boolean(
      leadDetails.phone
      || leadDetails.name
      || leadDetails.address
      || (hasExistingOrder && productChanged)
    );
  }

  function captureHandoffOrderUpdate(senderId, userText, opts = {}) {
    const previousDraft = storage.getOrderDraft(senderId);
    const leadDetails = buildLeadDetails(userText, senderId);
    if (!shouldCaptureHandoffOrderUpdate(senderId, userText, leadDetails, previousDraft)) return false;

    const currentLead = storage.mergeOrderDraft(senderId, leadDetails);
    trackEvent(senderId, 'handoff_order_update_received', userText, {
      fields: ['productCode', 'phone', 'name', 'address'].filter(field => Boolean(leadDetails[field]))
    });
    storage.appendCustomer({
      type: 'lead_update',
      senderId,
      ...currentLead,
      text: userText,
      history: storage.getHistory(senderId).slice(-10),
      at: new Date().toISOString()
    });

    const confirmedLead = buildConfirmedSheetLead(senderId, {
      messageId: opts.messageId || '',
      userText
    });
    void pushLeadToSheet(confirmedLead);
    sendTelegramAlert({
      ...confirmedLead,
      text: 'CẬP NHẬT ĐƠN TRONG HANDOFF'
    });
    return true;
  }

  return {
    buildConfirmedSheetLead,
    buildLeadDetails,
    captureHandoffOrderUpdate,
    notifyStaffForReadyOrder
  };
}

module.exports = {
  createLeadParser
};
