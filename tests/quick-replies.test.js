const { describe, it, expect } = require('./harness');
const {
  buildQuickReplies,
  inferSuggestionStage,
  resolveQuickReplyPayload
} = require('../core/quick-replies');

describe('quick replies: payload routing', () => {
  it('HOT_PRODUCTS map về câu rule-based hiện có', () => {
    const resolved = resolveQuickReplyPayload('HOT_PRODUCTS');
    expect(resolved.text).toBe('mẫu hot');
  });

  it('BUDGET_300 map về budget recommendation', () => {
    const resolved = resolveQuickReplyPayload('BUDGET_300');
    expect(resolved.text).toBe('mẫu nào dưới 300k');
  });

  it('payload không biết thì trả null', () => {
    expect(resolveQuickReplyPayload('UNKNOWN_PAYLOAD')).toBe(null);
  });
});

describe('quick replies: stage suggestions', () => {
  it('sau greeting ưu tiên action có dữ liệu thật, không có mẫu mới', () => {
    const replies = buildQuickReplies({ isGreeting: true });
    const payloads = replies.map(item => item.payload);

    expect(payloads).toEqual(['HOT_PRODUCTS', 'BUDGET_300', 'GEL_ACCESSORIES', 'QUICK_ADVICE']);
    expect(payloads.includes('NEW_PRODUCTS')).toBeFalse();
  });

  it('sau product detail có gel, mẫu hot, mẫu rẻ hơn, chốt mẫu này', () => {
    const replies = buildQuickReplies({
      stateAfterReply: 'PRODUCT_SELECTED',
      lastProductCode: 'MÃ7'
    });

    expect(replies.map(item => item.payload)).toEqual([
      'GEL_ACCESSORIES',
      'HOT_PRODUCTS',
      'CHEAPER_PRODUCTS',
      'ORDER_SELECTED'
    ]);
  });

  it('checkout chỉ gợi ý gửi thông tin và gặp nhân viên', () => {
    const replies = buildQuickReplies({ stateAfterReply: 'COLLECTING_INFO' });
    expect(replies.map(item => item.payload)).toEqual(['SEND_ORDER_INFO', 'HUMAN_HANDOFF']);
    expect(replies[0].title).toBe('📝 Gửi thông tin nhận hàng');
  });

  it('confirmed không show random actions', () => {
    expect(buildQuickReplies({ stateAfterReply: 'CONFIRMED' }).length).toBe(0);
  });

  it('fallback/confused gợi ý mẫu bán chạy và tư vấn nhanh', () => {
    const replies = buildQuickReplies({ fallbackUsed: true });
    expect(replies.map(item => item.payload)).toEqual(['HOT_PRODUCTS', 'QUICK_ADVICE']);
  });

  it('ưu tiên checkout stage hơn greeting nếu đang thu thông tin', () => {
    expect(inferSuggestionStage({
      isGreeting: true,
      stateAfterReply: 'COLLECTING_INFO'
    })).toBe('checkout');
  });

  it('reply chào "xem qua mẫu" vẫn hiện quick Hàng hot', () => {
    const replies = buildQuickReplies({
      replyText: '👋 Dạ em gửi mình xem qua mẫu bên shop nhé 😄 Ưng mã nào mình nhắn em tư vấn nhanh ạ.'
    });

    expect(replies.map(item => item.payload)).toEqual(['HOT_PRODUCTS', 'BUDGET_300', 'GEL_ACCESSORIES', 'QUICK_ADVICE']);
    expect(replies[0].title).toBe('🔥 Hàng hot');
  });
});
