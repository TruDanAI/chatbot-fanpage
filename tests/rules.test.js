const { describe, it, expect } = require('./harness');
const path = require('path');
const { loadProducts } = require('../core/products');
const shopConfig = require('../shops/adult-shop/config');
const adultCustomIntents = require('../shops/adult-shop/custom-intents');
const { createRuleEngine, STATES, detectors } = require('../core/rules');

const products = loadProducts(path.join(__dirname, '..', 'shops', 'adult-shop', 'products.csv'));
const adultConfig = {
  ...shopConfig,
  intents: {
    ...(shopConfig.intents || {}),
    prepend: [
      ...(adultCustomIntents.prepend || []),
      ...(shopConfig.intents?.prepend || [])
    ],
    append: [
      ...(shopConfig.intents?.append || []),
      ...(adultCustomIntents.append || [])
    ]
  }
};

// Mock contextStore (đầy đủ giống storage.js)
function makeStore() {
  const data = new Map();
  return {
    _data: data,
    getLastProductCode: id => data.get(id)?.lastProductCode || '',
    setLastProductCode: (id, code) => {
      const v = data.get(id) || {};
      v.lastProductCode = code;
      data.set(id, v);
    },
    getOrderDraft: id => ({ ...(data.get(id)?.orderDraft || {}) }),
    mergeOrderDraft(id, details) {
      const v = data.get(id) || {};
      v.orderDraft = { ...(v.orderDraft || {}), ...details };
      data.set(id, v);
      return { ...v.orderDraft };
    },
    getSessionState: id => data.get(id)?.sessionState || '',
    setSessionState: (id, s) => {
      const v = data.get(id) || {};
      if (s) v.sessionState = s;
      else delete v.sessionState;
      data.set(id, v);
    },
    clearOrderDraft: id => {
      const v = data.get(id) || {};
      delete v.orderDraft;
      delete v.sessionState;
      data.set(id, v);
    }
  };
}

describe('detectors: BUG FIX wantsCancelOrder', () => {
  it('TRUE với "thôi không lấy nữa"', () => {
    expect(detectors.wantsCancelOrder('thôi không lấy nữa')).toBeTrue();
  });
  it('TRUE với "hủy đơn"', () => {
    expect(detectors.wantsCancelOrder('hủy đơn cho mình')).toBeTrue();
  });
  it('TRUE với "không chốt nữa"', () => {
    expect(detectors.wantsCancelOrder('không chốt nữa shop ơi')).toBeTrue();
  });
  it('FALSE với "thôi không sao đâu" (BUG cũ)', () => {
    expect(detectors.wantsCancelOrder('thôi không sao đâu shop')).toBeFalse();
  });
  it('FALSE với "không hiểu"', () => {
    expect(detectors.wantsCancelOrder('không hiểu shop nói gì')).toBeFalse();
  });
});

describe('detectors: BUG FIX wantsHuman dùng preprocess', () => {
  it('TRUE với "nhân viên" (có dấu)', () => {
    expect(detectors.wantsHuman('cho mình gặp nhân viên')).toBeTrue();
  });
  it('TRUE với "nhan vien" (không dấu — BUG cũ miss)', () => {
    expect(detectors.wantsHuman('cho gap nhan vien tu van')).toBeTrue();
  });
  it('TRUE với "tu van vien"', () => {
    expect(detectors.wantsHuman('chuyen tu van vien giup em')).toBeTrue();
  });
  it('FALSE với câu thường', () => {
    expect(detectors.wantsHuman('cho mình xem MÃ8')).toBeFalse();
  });
});

describe('detectors: shipping privacy', () => {
  it('TRUE với "shop có giao kín ko ạ"', () => {
    expect(detectors.wantsShippingPrivacy('shop có giao kín ko ạ')).toBeTrue();
  });

  it('FALSE với câu hỏi giao hàng thường', () => {
    expect(detectors.wantsShippingPrivacy('shop giao hàng mấy ngày ạ')).toBeFalse();
  });
});

describe('detectors: BUG FIX substring trong chốt / tôi', () => {
  it('wantsBestSeller FALSE với "chốt đi" ("hot" trong "chot" — BUG cũ)', () => {
    expect(detectors.wantsBestSeller('chốt đi')).toBeFalse();
  });
  it('wantsBestSeller TRUE với từ "hot" độc lập', () => {
    expect(detectors.wantsBestSeller('shop có mẫu hot không')).toBeTrue();
  });
  it('wantsFeatureAdvice FALSE với "tôi chốt mã 3" ("to" trong "toi" — BUG cũ)', () => {
    expect(detectors.wantsFeatureAdvice('tôi chốt mã 3')).toBeFalse();
  });
  it('wantsFeatureAdvice TRUE với "mẫu to không"', () => {
    expect(detectors.wantsFeatureAdvice('mẫu to không shop')).toBeTrue();
  });
});

describe('detectors: BUG FIX isPriceClarification', () => {
  it('TRUE với "MÃ8 bao nhiêu vậy?"', () => {
    expect(detectors.isPriceClarification('MÃ8 bao nhiêu vậy?')).toBeTrue();
  });
  it('TRUE với "giá nhiêu"', () => {
    expect(detectors.isPriceClarification('giá nhiêu shop')).toBeTrue();
  });
  it('FALSE khi chỉ nhắc mã + giá, không hỏi xác nhận', () => {
    expect(detectors.isPriceClarification('MÃ8 300k')).toBeFalse();
  });
  it('TRUE khi nhắc giá kèm marker hỏi/xác nhận', () => {
    expect(detectors.isPriceClarification('MÃ8 là 300k hả shop?')).toBeTrue();
  });
});

describe('detectors: wantsAddressChange (BUG FIX)', () => {
  it('TRUE với "đổi địa chỉ"', () => {
    expect(detectors.wantsAddressChange('đổi địa chỉ giúp em')).toBeTrue();
  });
  it('TRUE với "đổi giúp em sang phường 5" (BUG cũ miss)', () => {
    expect(detectors.wantsAddressChange('đổi giúp em sang phường 5 quận 3')).toBeTrue();
  });
});

describe('Engine: intent router cơ bản', () => {
  const engine = createRuleEngine({
    products,
    config: shopConfig,
    contextStore: makeStore()
  });

  it('GREETING', () => {
    expect(engine.buildDeterministicReply('em chào shop', 'u1')).toContain('xem qua mẫu');
  });
  it('GREETING nhận câu chào có "ạ"', () => {
    expect(engine.buildDeterministicReply('chào shop ạ', 'u1a')).toContain('xem qua mẫu');
  });
  it('PRODUCT_LIST khi user gõ mã', () => {
    expect(engine.buildDeterministicReply('m8 còn không', 'u2')).toContain('MÃ8');
  });
  it('PRODUCT_LIST một mã trả lời dạng tư vấn', () => {
    const reply = engine.buildDeterministicReply('mã 7', 'u_ma7');
    expect(reply).toContain('Dạ mã 7 bên em đang 560k nha mình');
    expect(reply).toContain('form khá mềm và chân thật');
    expect(reply).toContain('size 12x25cm');
    expect(reply).toContain('tặng kèm 10 gói gel luôn ạ');
  });
  it('ORDER_INTENT chuyển sang checkout', () => {
    const reply = engine.buildDeterministicReply('chốt MÃ8', 'u3');
    expect(reply).toContain('Dạ em chốt giúp mình');
    expect(reply).toContain('MÃ8');
    expect(reply).toContain('Tên người nhận');
  });
  it('"chốt đi" không trigger BEST_SELLER (BUG: hot trong chot)', () => {
    const store = makeStore();
    store.setLastProductCode('u_chot', 'MÃ10');
    const eng = createRuleEngine({ products, config: shopConfig, contextStore: store });
    const r = eng.buildDeterministicReply('chốt đi', 'u_chot');
    expect(r).toContain('MÃ10');
    expect(r).toContain('Tên người nhận');
    expect(r.includes('bán chạy')).toBe(false);
  });
  it('"tôi chốt mã 3" → ORDER_INTENT MÃ3, không BEST_SELLER', () => {
    const reply = engine.buildDeterministicReply('tôi chốt mã 3 nhé', 'u_ct3');
    expect(reply).toContain('MÃ3');
    expect(reply).toContain('Tên người nhận');
    expect(reply.includes('bán chạy')).toBe(false);
  });
  it('"loại 150k thế nào" → BUDGET, không PRICE mã last', () => {
    const store = makeStore();
    store.setLastProductCode('u_150', 'MÃ3');
    const eng = createRuleEngine({ products, config: shopConfig, contextStore: store });
    const r = eng.buildDeterministicReply('loại 150k thế nào vậy shop', 'u_150');
    expect(r).toContain('150');
    expect(r).toContain('MÃ10');
    expect(r).toContain('Tầm khoảng 150k');
  });
  it('"có mã nào dưới 200k không" → BUDGET, không PRICE mã last', () => {
    const store = makeStore();
    store.setLastProductCode('u_under_200', 'MÃ7');
    const eng = createRuleEngine({ products, config: shopConfig, contextStore: store });
    const r = eng.buildDeterministicReply('có mã nào dưới 200k không', 'u_under_200');
    expect(r).toContain('Dạ có nha mình');
    expect(r).toContain('Tầm dưới 200k');
    expect(r).toContain('Để em gửi mình mấy mẫu đang được hỏi nhiều trong tầm giá này');
    expect(r).toContain('MÃ10');
    expect(r).toContain('150k');
    expect(r.includes('MÃ7 giá 560k')).toBeFalse();
  });
  it('"Cos mã nào dưới 200k ko shop" → BUDGET, không PRICE mã last', () => {
    const store = makeStore();
    store.setLastProductCode('u_under_200_typo', 'MÃ7');
    const eng = createRuleEngine({ products, config: shopConfig, contextStore: store });
    const r = eng.buildDeterministicReply('Cos mã nào dưới 200k ko shop', 'u_under_200_typo');
    expect(r).toContain('Tầm dưới 200k');
    expect(r).toContain('MÃ10');
    expect(r).toContain('150k');
    expect(r.includes('MÃ7 giá 560k')).toBeFalse();
  });
  it('PRODUCT_NOT_FOUND khi mã ngoài menu', () => {
    expect(engine.buildDeterministicReply('cho xem MÃ99', 'u4')).toContain('MÃ99');
  });
  it('không coi "MÃ8 300k" là PRICE_CLARIFICATION', () => {
    const reply = engine.buildDeterministicReply('MÃ8 300k', 'u_price_mention');
    expect(reply).toContain('mã 8 bên em đang 680k');
    expect(reply.includes('giá 680k')).toBeFalse();
  });
  it('"đổi sang mã 10" dùng đúng mã mới thay vì hỏi lại', () => {
    const reply = engine.buildDeterministicReply('đổi sang mã 10 giúp em', 'u_change_code');
    expect(reply).toContain('MÃ10');
    expect(reply).toContain('150k');
    expect(reply.includes('nhắn giúp em mã sản phẩm muốn đổi sang')).toBeFalse();
  });
  it('tư vấn người mới/dễ dùng không cần Gemini', () => {
    const reply = engine.buildDeterministicReply('người mới nên bắt đầu mẫu nào dễ dùng', 'u_easy');
    expect(reply).toContain('dễ dùng');
    expect(reply).toContain('MÃ10');
  });
  it('hỏi chất liệu theo mã trả lời từ mô tả sản phẩm', () => {
    const reply = engine.buildDeterministicReply('MÃ8 chất liệu có mềm không', 'u_material');
    expect(reply).toContain('MÃ8');
    expect(reply).toContain('Sạc pin');
  });
  it('hỏi mẫu kín đáo/dễ cất gợi ý mẫu nhỏ gọn', () => {
    const reply = engine.buildDeterministicReply('mẫu nào nhỏ gọn dễ cất không lộ', 'u_quiet');
    expect(reply).toContain('kín đáo');
    expect(reply).toContain('MÃ10');
  });
});

describe('Engine: adult-shop experience advice', () => {
  it('"Co suong k e" không rơi vào fallback/Gemini', () => {
    const engine = createRuleEngine({ products, config: adultConfig, contextStore: makeStore() });
    const reply = engine.buildDeterministicReply('Co suong k e', 'u_exp_default');

    expect(reply).toContain('tuỳ mã và nhu cầu');
    expect(reply).toContain('có rung');
    expect(reply).toContain('MÃ2');
  });

  it('hỏi cảm giác theo mã trả lời bám đúng mã đang chọn', () => {
    const engine = createRuleEngine({ products, config: adultConfig, contextStore: makeStore() });
    const reply = engine.buildDeterministicReply('MÃ8 dùng có sướng không shop', 'u_exp_selected');

    expect(reply).toContain('MÃ8');
    expect(reply).toContain('cảm giác thoải mái');
  });
});

describe('Engine: state machine 5 trạng thái', () => {
  const store = makeStore();
  const engine = createRuleEngine({ products, config: shopConfig, contextStore: store });
  const u = 'u_state';

  it('IDLE ban đầu', () => {
    expect(engine.deriveSessionState(u)).toBe(STATES.IDLE);
  });
  it('PRODUCT_SELECTED sau khi nhắc mã', () => {
    engine.buildDeterministicReply('cho xem ma 8', u);
    expect(engine.deriveSessionState(u)).toBe(STATES.PRODUCT_SELECTED);
  });
  it('COLLECTING_INFO khi có tên + sđt', () => {
    store.mergeOrderDraft(u, { name: 'An', phone: '0987654321' });
    expect(engine.deriveSessionState(u)).toBe(STATES.COLLECTING_INFO);
  });
  it('READY_TO_CONFIRM khi đủ 3 trường', () => {
    store.mergeOrderDraft(u, { address: '12 Trần Phú, Hà Nội', productCode: 'MÃ8' });
    expect(engine.deriveSessionState(u)).toBe(STATES.READY_TO_CONFIRM);
  });
  it('shouldSilenceAfterCompleteOrder = true với "ok"', () => {
    expect(engine.shouldSilenceAfterCompleteOrder('ok shop', u)).toBeTrue();
  });
  it('CONFIRMED sau khi user "ok"', () => {
    expect(engine.deriveSessionState(u)).toBe(STATES.CONFIRMED);
  });
  it('CANCEL_ORDER hạ về IDLE/PRODUCT_SELECTED', () => {
    engine.buildDeterministicReply('thôi không lấy nữa', u);
    const s = engine.deriveSessionState(u);
    expect(s === STATES.IDLE || s === STATES.PRODUCT_SELECTED).toBeTrue();
    const draft = store.getOrderDraft(u);
    expect(!draft.name && !draft.phone && !draft.address).toBeTrue();
  });
});

describe('Engine: checkout context không rơi về gel/fallback', () => {
  it('chốt MÃ8 kèm gel tạo checkout và lưu cart', () => {
    const store = makeStore();
    const engine = createRuleEngine({ products, config: adultConfig, contextStore: store });
    const reply = engine.buildDeterministicReply('chốt cho em mã 8 và 1 chai gel nhé', 'u_checkout_gel');

    expect(reply).toContain('Dạ em chốt giúp mình');
    expect(reply).toContain('MÃ8');
    expect(reply).toContain('1 gel 200ml');
    expect(reply).toContain('Tên người nhận');
    expect(reply).notToBe(shopConfig.templates.gelInfo);
    expect(engine.deriveSessionState('u_checkout_gel')).toBe(STATES.COLLECTING_INFO);
    expect(store.getOrderDraft('u_checkout_gel').cartItems.length).toBe(2);
  });

  it('lấy gel đào và MÃ8 vẫn vào checkout, không trả lại giá gel', () => {
    const store = makeStore();
    const engine = createRuleEngine({ products, config: adultConfig, contextStore: store });
    const reply = engine.buildDeterministicReply('dạ vâng lấy cho loại gel đào và mã 8 nhé', 'u_checkout_gel_dao');

    expect(reply).toContain('Dạ em chốt giúp mình');
    expect(reply).toContain('MÃ8');
    expect(reply).toContain('1 gel đào 200ml');
    expect(reply).notToBe(shopConfig.templates.gelInfo);
  });

  it('"ok" theo context sản phẩm chuyển sang xin thông tin, không null/Gemini', () => {
    const store = makeStore();
    const engine = createRuleEngine({ products, config: adultConfig, contextStore: store });
    engine.buildDeterministicReply('Tư vấn MÃ8', 'u_ok_context');

    const reply = engine.buildDeterministicReply('ok', 'u_ok_context');
    expect(reply).toContain('Dạ em chốt giúp mình');
    expect(reply).toContain('MÃ8');
    expect(reply).toContain('SĐT');
  });

  it('"?" theo context checkout nhắc lại bước xin thông tin', () => {
    const store = makeStore();
    const engine = createRuleEngine({ products, config: adultConfig, contextStore: store });
    engine.buildDeterministicReply('chốt mã 8', 'u_question_context');

    const reply = engine.buildDeterministicReply('?', 'u_question_context');
    expect(reply).toContain('Tên người nhận');
    expect(reply).toContain('Địa chỉ nhận hàng');
  });

  it('readyOrder xác nhận đủ tất cả cartItems, không chỉ lastProductCode', () => {
    const store = makeStore();
    const engine = createRuleEngine({ products, config: adultConfig, contextStore: store });
    const userId = 'u_ready_cart';

    engine.buildDeterministicReply('chốt mã 8', userId);
    engine.buildDeterministicReply('chốt thêm mã 10', userId);
    store.mergeOrderDraft(userId, {
      name: 'Hân',
      phone: '0123456789',
      address: 'Đồng Me, Mễ Trì, Hà Nội'
    });

    const reply = engine.buildDeterministicReply('Hân 0123456789 Đồng Me, Mễ Trì, Hà Nội', userId);
    expect(reply).toContain('• MÃ8');
    expect(reply).toContain('• MÃ10');
    expect(/chốt\s+MÃ10 rồi/.test(reply)).toBeFalse();
  });

  it('đang COLLECTING_INFO hỏi cần gửi gì thì chỉ nhắc field, không replay cart', () => {
    const store = makeStore();
    const engine = createRuleEngine({ products, config: adultConfig, contextStore: store });
    const userId = 'u_order_info_reminder';
    engine.buildDeterministicReply('chốt mã 8', userId);

    const reply = engine.buildDeterministicReply('chốt đơn cần gửi thông tin gì?', userId);
    expect(reply).toContain('Tên người nhận');
    expect(reply).toContain('SĐT');
    expect(reply).toContain('Địa chỉ nhận hàng');
    expect(reply.includes('Dạ em chốt giúp mình')).toBeFalse();
    expect(reply.includes('MÃ8')).toBeFalse();
  });

  it('tracking intent khi đang checkout trả lời trạng thái chờ shop xác nhận/gửi hàng', () => {
    const store = makeStore();
    const engine = createRuleEngine({ products, config: adultConfig, contextStore: store });
    const userId = 'u_tracking_checkout';
    engine.buildDeterministicReply('chốt mã 8', userId);

    const reply = engine.buildDeterministicReply('mã vận đơn đâu shop', userId);
    expect(reply).toContain('đang chờ shop xác nhận/gửi hàng');
    expect(reply).toContain('mã vận đơn GHTK');
  });

  it('tracking intent khi chưa có đơn trả lời policy mã vận đơn', () => {
    const store = makeStore();
    const engine = createRuleEngine({ products, config: adultConfig, contextStore: store });

    const reply = engine.buildDeterministicReply('tracking đơn tới đâu shop', 'u_tracking_idle');
    expect(reply).toContain('sau khi shop xác nhận và gửi hàng');
    expect(reply).toContain('mã vận đơn GHTK');
  });
});

describe('Engine: BUG FIX user hỏi địa chỉ shop không bị nhầm là cung cấp địa chỉ', () => {
  const engine = createRuleEngine({
    products,
    config: shopConfig,
    contextStore: makeStore()
  });

  it('Câu "địa chỉ shop ở đâu?" KHÔNG trigger PROVIDES_NAME_OR_ADDRESS', () => {
    const reply = engine.buildDeterministicReply('địa chỉ shop ở đâu vậy?', 'u_addr_q');
    // Reply nên là OFFICE_PICKUP hoặc null/khác — KHÔNG được là "em nhận thông tin rồi".
    if (reply) {
      expect(reply).notToBe('Dạ em nhận thông tin rồi ạ. Anh/chị chọn giúp em mã sản phẩm muốn lấy, hoặc nhắn "menu" để em gửi danh sách sản phẩm nhé.');
    }
  });
});

describe('Engine: config-driven intent disable', () => {
  const customConfig = {
    ...shopConfig,
    intents: { disabled: ['AGE_POLICY', 'GREETING'] }
  };
  const engine = createRuleEngine({
    products,
    config: customConfig,
    contextStore: makeStore()
  });

  it('GREETING bị tắt -> không match câu chào', () => {
    const reply = engine.buildDeterministicReply('em chào shop', 'u_disabled');
    // Có thể null hoặc match rule khác, nhưng không phải template greeting.
    if (reply) {
      expect(reply.includes('xem danh sách sản phẩm') ? 'KHÔNG match GREETING' : 'OK').toBe('OK');
    }
  });
  it('AGE_POLICY bị tắt -> không reply về tuổi', () => {
    const reply = engine.buildDeterministicReply('em 16 tuổi mua được không', 'u_age');
    if (reply) {
      expect(/từ đủ \d+ tuổi/i.test(reply)).toBeFalse();
    }
  });
});

describe('Engine: config-driven custom intent (prepend)', () => {
  const customConfig = {
    ...shopConfig,
    templates: {
      ...((shopConfig && shopConfig.templates) || {}),
      voucherInfo: 'Voucher hôm nay: GIAM10K, dùng được cho đơn từ 200k.'
    },
    intents: {
      prepend: [
        {
          name: 'VOUCHER',
          match: ctx => /voucher|ma giam|coupon/.test(ctx.normalized),
          handle: ctx => ctx.render('voucherInfo')
        }
      ]
    }
  };
  const engine = createRuleEngine({
    products,
    config: customConfig,
    contextStore: makeStore()
  });

  it('Custom intent VOUCHER được trigger', () => {
    const reply = engine.buildDeterministicReply('shop có voucher gì không', 'u_v');
    expect(reply).toContain('Voucher hôm nay');
  });
});

describe('Engine: template override per-shop', () => {
  const customConfig = {
    ...shopConfig,
    templates: {
      ...((shopConfig && shopConfig.templates) || {}),
      greeting: 'Chào bạn 🌸 Mình là trợ lý của {{shopName}}.'
    }
  };
  const engine = createRuleEngine({
    products,
    config: customConfig,
    contextStore: makeStore()
  });

  it('Template "greeting" đã được override', () => {
    const reply = engine.buildDeterministicReply('chào shop', 'u_o');
    expect(reply).toContain('🌸');
  });
});

describe('Engine: backward-compat exports', () => {
  const m = require('../core/rules');
  it('createRuleEngine là function', () => {
    expect(typeof m.createRuleEngine).toBe('function');
  });
  it('STATES có 5 trạng thái', () => {
    expect(Object.keys(m.STATES).length).toBe(5);
  });
  it('detectors object expose các hàm wants*', () => {
    expect(typeof m.detectors.wantsCancelOrder).toBe('function');
    expect(typeof m.detectors.wantsHuman).toBe('function');
  });
});
