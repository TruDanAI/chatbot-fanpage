const { describe, it, expect } = require('./harness');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = path.join(os.tmpdir(), 'chatbot-fanpage-tests', String(process.pid));
process.env.FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'test-verify-token';
process.env.FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || 'test-page-token';
process.env.USE_GEMINI = 'false';

const {
  buildGeminiRequestHistory,
  buildGeminiRuntimeContext,
  buildLeadDetails,
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
