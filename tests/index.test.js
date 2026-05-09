const { describe, it, expect } = require('./harness');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = path.join(os.tmpdir(), 'chatbot-fanpage-tests', String(process.pid));
process.env.FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'test-verify-token';
process.env.FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || 'test-page-token';
process.env.FB_APP_SECRET = process.env.FB_APP_SECRET || 'test-app-secret';
process.env.USE_GEMINI = 'false';

const {
  buildAbandonedCartReminderText,
  buildGeminiRequestHistory,
  buildGeminiRuntimeContext,
  buildLeadDetails,
  buildTelegramLeadAlertText,
  buildTelegramUserLines,
  getAdminRequestToken,
  getFacebookProfileDisplayName,
  maybeResetTimedOutSession,
  redactSensitiveText,
  recordConversationTurn
} = require('../index');
const storage = require('../core/storage');

describe('index: buildLeadDetails parser hồi quy', () => {
  it('"đổi sang mã 10" đổi sản phẩm, không ghi address = "ma 10"', () => {
    const userId = 'idx_change_product';
    storage.clearOrderDraft(userId);
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }],
      name: 'An',
      phone: '0987654321',
      address: '12 Old Street'
    });

    const details = buildLeadDetails('đổi sang mã 10 giúp em', userId);

    expect(details.productCode).toBe('MÃ10');
    expect(details.address).toBe('');
    expect(details.cartItems.length).toBe(1);
    expect(details.cartItems[0].code).toBe('MÃ10');
  });

  it('đổi mẫu vẫn giữ phụ kiện gel trong cart', () => {
    const userId = 'idx_change_product_keep_gel';
    storage.clearOrderDraft(userId);
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [
        { code: 'MÃ8', name: 'MÃ8', qty: 1 },
        { code: 'GEL', name: 'gel', qty: 1, variant: 'đào' }
      ],
      name: 'An',
      phone: '0987654321',
      address: '12 Old Street'
    });

    const details = buildLeadDetails('đổi qua mã 10 nha', userId);

    expect(details.cartItems.length).toBe(2);
    expect(details.cartItems[0].code).toBe('MÃ10');
    expect(details.cartItems[1].code).toBe('GEL');
  });

  it('parse format phone trước tên và địa chỉ', () => {
    const details = buildLeadDetails('0987654321 Nguyen Van A 12 Tran Phu', 'idx_phone_first');

    expect(details.phone).toBe('0987654321');
    expect(details.name).toBe('Nguyen Van A');
    expect(details.address).toBe('12 Tran Phu');
  });

  it('parse format có nhãn sdt/ten/dia chi theo thứ tự bất kỳ trong câu', () => {
    const details = buildLeadDetails('sdt 0987654321 ten Nguyễn Văn A dia chi 12 Trần Phú', 'idx_labeled');

    expect(details.phone).toBe('0987654321');
    expect(details.name).toBe('Nguyễn Văn A');
    expect(details.address).toBe('12 Trần Phú');
  });

  it('parse câu "mình tên ..." khi khách đã gửi SĐT và địa chỉ trước đó', () => {
    const userId = 'idx_name_after_phone_address';
    storage.clearOrderDraft(userId);
    storage.mergeOrderDraft(userId, {
      phone: '0987654321',
      address: '12 Trần Phú'
    });

    const details = buildLeadDetails('mình tên An Nguyen', userId);

    expect(details.name).toBe('An Nguyen');
    expect(details.address).toBe('');
  });

  it('đổi địa chỉ không có chữ "địa chỉ" vẫn chỉ nhận khi phần sau giống địa chỉ', () => {
    const details = buildLeadDetails('đổi giúp em sang phường 5 quận 3', 'idx_address_change');

    expect(details.address).toBe('phường 5 quận 3');
  });
});

describe('index: Gemini context smoothing', () => {
  it('ghi cả lượt rule-based vào history để Gemini fallback không mất ngữ cảnh', () => {
    const userId = 'idx_gemini_history';
    storage.setHistory(userId, []);

    recordConversationTurn(userId, 'mã 8', 'Dạ mã 8 bên em đang 680k nha mình');
    const history = storage.getHistory(userId);

    expect(history.length).toBe(2);
    expect(history[0].role).toBe('user');
    expect(history[0].parts[0].text).toBe('mã 8');
    expect(history[1].role).toBe('model');
    expect(history[1].parts[0].text).toContain('680k');
  });

  it('Gemini runtime context có lastProduct + order draft để trả lời câu ngoài rule', () => {
    const userId = 'idx_gemini_context';
    storage.clearOrderDraft(userId);
    storage.setLastProductCode(userId, 'MÃ8');
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }],
      phone: '0987654321'
    });

    const context = buildGeminiRuntimeContext(userId);

    expect(context).toContain('MÃ8 giá 680k');
    expect(context).toContain('Đơn/giỏ nháp: 1 x MÃ8');
    expect(context).toContain('SĐT: 0987654321');
  });

  it('Gemini request history kèm context vào tin nhắn hiện tại nhưng vẫn giữ history cũ', () => {
    const userId = 'idx_gemini_request_history';
    storage.setHistory(userId, []);
    storage.setLastProductCode(userId, 'MÃ10');
    recordConversationTurn(userId, 'mã 10', 'Dạ mã 10 bên em đang 150k nha mình');

    const history = buildGeminiRequestHistory(userId, 'mẫu đó dùng sao shop');

    expect(history.length).toBe(3);
    expect(history[1].parts[0].text).toContain('150k');
    expect(history[2].parts[0].text).toContain('MÃ10 giá 150k');
    expect(history[2].parts[0].text).toContain('Tin nhắn khách cần trả lời');
    expect(history[2].parts[0].text).toContain('mẫu đó dùng sao shop');
  });
});

describe('index: security hardening helpers', () => {
  it('redactSensitiveText che SĐT, email và trường địa chỉ trong log/event', () => {
    const redacted = redactSensitiveText('Tên Nguyễn A, sdt 0987654321, email a@test.com, địa chỉ 12 Trần Phú');

    expect(redacted.includes('0987654321')).toBeFalse();
    expect(redacted.includes('a@test.com')).toBeFalse();
    expect(redacted.includes('12 Trần Phú')).toBeFalse();
    expect(redacted).toContain('[redacted-email]');
    expect(redacted).toContain('[redacted-address]');
  });

  it('getAdminRequestToken chỉ nhận header, không nhận query token', () => {
    const req = {
      query: { token: 'from-query' },
      get(name) {
        return name === 'x-admin-token' ? 'from-header' : '';
      }
    };

    expect(getAdminRequestToken(req)).toBe('from-header');
  });

  it('getAdminRequestToken nhận Authorization Bearer khi không có x-admin-token', () => {
    const req = {
      query: { token: 'from-query' },
      get(name) {
        return name === 'authorization' ? 'Bearer bearer-token' : '';
      }
    };

    expect(getAdminRequestToken(req)).toBe('bearer-token');
  });
});

describe('index/storage: nhắc giỏ bỏ dở', () => {
  const now = Date.parse('2026-05-08T00:00:00.000Z');
  const oldEnough = new Date(now - 21 * 60 * 1000).toISOString();

  it('render lời nhắc theo thông tin còn thiếu', () => {
    const text = buildAbandonedCartReminderText({
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }],
      phone: '0987654321'
    });

    expect(text).toContain('1 x MÃ8');
    expect(text).toContain('tên người nhận + địa chỉ giao hàng');
    expect(text).notToBe('');
  });

  it('lọc draft checkout thiếu thông tin sau thời gian idle', () => {
    const userId = 'idx_abandoned_candidate';
    storage.clearOrderDraft(userId);
    storage.setLastUserAt(userId, oldEnough);
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }],
      phone: '0987654321'
    });

    const candidate = storage.listAbandonedCartReminderCandidates({
      now,
      idleMs: 20 * 60 * 1000,
      maxAgeMs: 23 * 60 * 60 * 1000
    }).find(item => item.userId === userId);

    expect(Boolean(candidate)).toBeTrue();
    expect(candidate.missingFields).toEqual(['name', 'address']);
  });

  it('không nhắc khách chỉ hỏi/xem mã sản phẩm, chưa có cartItems checkout', () => {
    const userId = 'idx_product_view_not_abandoned';
    storage.clearOrderDraft(userId);
    storage.setLastUserAt(userId, oldEnough);
    storage.mergeOrderDraft(userId, { productCode: 'MÃ8' });

    const candidate = storage.listAbandonedCartReminderCandidates({
      now,
      idleMs: 20 * 60 * 1000,
      maxAgeMs: 23 * 60 * 60 * 1000
    }).find(item => item.userId === userId);

    expect(Boolean(candidate)).toBeFalse();
  });

  it('đã gửi nhắc thì không đưa lại vào candidate', () => {
    const userId = 'idx_abandoned_sent_once';
    storage.clearOrderDraft(userId);
    storage.setLastUserAt(userId, oldEnough);
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }]
    });
    storage.markAbandonedCartReminderSent(userId, {
      at: new Date(now).toISOString(),
      idleMs: 21 * 60 * 1000,
      missingFields: ['name', 'phone', 'address']
    });

    const candidate = storage.listAbandonedCartReminderCandidates({
      now,
      idleMs: 20 * 60 * 1000,
      maxAgeMs: 23 * 60 * 60 * 1000
    }).find(item => item.userId === userId);

    expect(Boolean(candidate)).toBeFalse();
  });

  it('lỗi gửi 4xx đã đánh dấu thì không retry liên tục', () => {
    const userId = 'idx_abandoned_failed_once';
    storage.clearOrderDraft(userId);
    storage.setLastUserAt(userId, oldEnough);
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }]
    });
    storage.markAbandonedCartReminderFailed(userId, {
      at: new Date(now).toISOString(),
      status: 400,
      error: 'recipient unavailable'
    });

    const candidate = storage.listAbandonedCartReminderCandidates({
      now,
      idleMs: 20 * 60 * 1000,
      maxAgeMs: 23 * 60 * 60 * 1000
    }).find(item => item.userId === userId);

    expect(Boolean(candidate)).toBeFalse();
  });

  it('khách trả lời sau lời nhắc gần đây không bị timeout xóa draft', () => {
    const userId = 'idx_reminder_extends_timeout';
    storage.clearOrderDraft(userId);
    storage.setLastUserAt(userId, new Date(Date.now() - 31 * 60 * 1000).toISOString());
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }]
    });
    storage.markAbandonedCartReminderSent(userId, {
      at: new Date().toISOString(),
      idleMs: 20 * 60 * 1000,
      missingFields: ['name', 'phone', 'address']
    });

    const reset = maybeResetTimedOutSession(userId, '0987654321 An 12 Tran Phu');

    expect(reset).toBeFalse();
    expect(storage.getOrderDraft(userId).cartItems.length).toBe(1);
  });
});

describe('index: Telegram hiển thị tên Facebook', () => {
  it('format User bằng tên Facebook và vẫn giữ ID để tra soát', () => {
    const lines = buildTelegramUserLines('123456789', {
      firstName: 'Nguyễn',
      lastName: 'An'
    });

    expect(lines).toEqual(['User: Nguyễn An', 'Facebook ID: 123456789']);
  });

  it('fallback về senderId khi chưa lấy được profile Facebook', () => {
    expect(buildTelegramUserLines('123456789', {})).toEqual(['User: 123456789']);
  });

  it('alert đơn hàng tách tên Facebook và tên nhận hàng', () => {
    const text = buildTelegramLeadAlertText({
      senderId: '123456789',
      text: 'ĐƠN ĐỦ THÔNG TIN - CHỜ KHÁCH OK',
      name: 'Tran Van B',
      phone: '0987654321',
      address: '12 Tran Phu',
      productCode: 'MÃ8'
    }, {
      name: 'Nguyễn An'
    });

    expect(text).toContain('User: Nguyễn An');
    expect(text).toContain('Facebook ID: 123456789');
    expect(text).toContain('Tên nhận hàng: Tran Van B');
    expect(text).toContain('Sản phẩm: MÃ8');
  });

  it('ưu tiên profile.name khi có sẵn', () => {
    expect(getFacebookProfileDisplayName({
      name: 'Le Minh',
      firstName: 'Ignored',
      lastName: 'Name'
    })).toBe('Le Minh');
  });
});
