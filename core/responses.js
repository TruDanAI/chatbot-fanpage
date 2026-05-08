// Tách hoàn toàn "Văn bản" khỏi "Logic" — toàn bộ chuỗi trả lời được tập trung tại đây.
// Cú pháp template: dùng {{biến}} hoặc {{a.b.c}} cho object lồng nhau.
// Shop cụ thể có thể override template qua config.templates trong shops/<id>/config.js.

const TEMPLATES = {
  // ===== Chào / xác nhận / từ chối =====
  greeting: '👋 Dạ em gửi mình xem qua mẫu bên shop nhé 😄 Ưng mã nào mình nhắn em tư vấn nhanh ạ.',
  rejectOrder: 'Dạ vâng ạ 😄 Mình cứ tham khảo thoải mái nha. Ưng mẫu nào em báo giá/video thật cho mình luôn ạ.',
  cancelOrder: 'Dạ không sao đâu ạ 😄 Khi nào cần xem lại hoặc chốt mẫu nào mình nhắn em nhé.',
  changeProduct: 'Dạ được ạ 👌 Mình nhắn giúp em mã muốn đổi sang, em check lại giá và mẫu cho mình ngay ạ.',

  // ===== Đơn hàng =====
  readyOrder: 'Dạ em nhận đủ thông tin chốt {{productText}} rồi ạ. Bên em nhận hàng thanh toán, che tên sản phẩm và gửi mã vận đơn GHTK để mình theo dõi nhé.',
  addressChangeReady: 'Dạ được ạ, mình gửi em địa chỉ mới nhé.',
  addressChangeMissing: 'Dạ mình gửi thêm {{missing}} giúp em nhé.',
  apologyRepeatedReady: 'Dạ em xin lỗi ạ, em đã nhận đủ thông tin đơn {{productText}} rồi. Bên em sẽ xác nhận lại trước khi gửi nhé.',
  apologyRepeatedMissing: 'Dạ em xin lỗi ạ, em còn thiếu {{missing}} để xác nhận đơn.',
  phoneWithLeadMissing: 'Dạ em nhận thông tin rồi ạ. Mình gửi thêm {{missing}} giúp em nhé.',
  phoneOnlyMissing: 'Dạ em nhận SĐT rồi ạ. Mình gửi thêm {{otherFields}} giúp em nhé.',
  infoMissingWithProduct: 'Dạ để chốt {{productCode}}, mình gửi thêm {{missing}} giúp em nhé.',
  infoMissingNoProduct: 'Dạ mình chọn giúp em mã muốn lấy, hoặc nhắn "menu" em gửi sản phẩm nhé.',
  orderInfoRequest: 'Dạ chốt đơn{{productSuffix}} mình gửi em {{orderInfoFields}} nhé.',
  orderIntentNoProduct: 'Dạ mình muốn chốt mã nào thì nhắn em mã sản phẩm nhé.',
  orderIntentWithProduct: 'Dạ {{productCode}} giá {{price}} ạ. Mình chốt thì gửi em {{orderInfoFields}} nhé. Bên em nhận hàng thanh toán, che tên sản phẩm trước khi gửi.',

  // ===== Sản phẩm / giá / so sánh =====
  productNotFound: 'Dạ hiện bên em chưa có {{codes}} ạ. Mình xem mã khác trong menu giúp em nhé.',
  priceClarification: 'Dạ {{productCode}} giá {{price}} ạ. Mẫu này {{stockText}}{{giftText}}.',
  comparison: 'Dạ em so sánh nhanh cho mình nhé:\n{{lines}}\nNếu ưu tiên tiết kiệm thì chọn mẫu giá thấp hơn; nếu muốn trải nghiệm thật/to hơn thì chọn mẫu kích thước lớn hơn ạ.',
  productList: 'Dạ em gửi mình xem qua:\n{{lines}}\n{{photoNote}}',
  productListPhotoSent: 'Ưng mã nào mình nhắn em tư vấn ạ.',
  productListAskPhoto: 'Ưng mã nào mình nhắn em tư vấn ạ.',

  // ===== Hình ảnh / menu =====
  menuSent: 'Dạ em gửi mình xem qua sản phẩm nhé. Ưng mã nào nhắn em tư vấn ạ.',
  productImage: 'Dạ em gửi ảnh {{productCode}} mình xem qua nhé. Ưng mẫu này thì gửi em {{orderInfoFields}} ạ.',
  gelInfo: 'Dạ shop có sản phẩm gel trong menu ạ. Mình xem ảnh kèm tin nhắn hoặc nhắn em mã để em báo giá chi tiết nhé.',
  newProducts: 'Dạ hiện shop tư vấn theo danh sách menu đang có ạ. Nếu có mẫu mới shop sẽ cập nhật thêm vào menu; mình muốn xem lại danh sách hiện tại thì em gửi ảnh menu tham khảo nhé.',

  // ===== Thông tin hàng / size / quà / fit / vệ sinh =====
  stockInfoSelected: 'Dạ {{productCode}} {{stockText}} ạ. Trước khi gửi hàng shop sẽ xác nhận lại đơn cho mình nhé.',
  stockInfoUnknown: 'Dạ mình nhắn giúp em mã sản phẩm muốn hỏi còn hàng, ví dụ MÃ8 hoặc MÃ13, em kiểm tra và báo đúng mẫu cho mình ạ.',
  bestSeller: '🔥 Mấy mẫu này đang được hỏi nhiều nhất hôm nay nha mình 😄',
  sizeInfo: 'Dạ {{productCode}} có size {{size}}{{weightText}}.{{descSuffix}}',
  giftInfo: 'Dạ {{compactProductName}}{{giftText}} ạ. Bên em freeship, che tên sản phẩm trước khi gửi nhé.',
  fitInfo: 'Dạ {{productCode}} chất liệu và thiết kế theo mô tả sản phẩm ạ. Mình cần thêm phụ kiện kèm theo thì nhắn em nhé.',
  materialInfo: 'Dạ {{productCode}} theo mô tả là {{description}}. Nếu mình ưu tiên mềm/chân thật hơn thì nên chọn các mẫu silicon loại 1 và size phù hợp ngân sách ạ.',
  easyUseInfo: 'Dạ nếu ưu tiên dễ dùng/dễ vệ sinh thì mình chọn mẫu nhỏ gọn trước như {{options}}. Các mẫu lớn cho cảm giác thật hơn nhưng nặng và cần vệ sinh kỹ hơn ạ.',
  cleaningInfo: 'Dạ vệ sinh được ạ. Sau khi dùng mình rửa nhẹ bằng nước sạch hoặc dung dịch vệ sinh chuyên dụng, lau khô rồi để nơi thoáng mát; tránh ngâm phần điện/tử (nếu mẫu có) ạ.',

  // ===== Chính sách =====
  agePolicy: 'Dạ sản phẩm bên {{shopName}} có quy định độ tuổi/phạm vi bán hàng theo chính sách shop ạ. Nếu mình đã đủ {{minAge}} tuổi thì em hỗ trợ tư vấn bình thường nhé.',
  shippingPrivacy: 'Dạ bên em che tên sản phẩm trước khi gửi đi. Nhận hàng thanh toán, có mã vận đơn GHTK để mình theo dõi nhé.',
  inspection: 'Dạ khi nhận hàng mình kiểm tra tình trạng gói hàng bên ngoài giúp shop; nếu có vấn đề, mình chụp ảnh/quay video để nhân viên hỗ trợ nhanh ạ.',
  shippingFee: 'Dạ bên em freeship ạ. Mình chốt mã nào gửi em thông tin nhận hàng là được nhé.',
  discount: 'Dạ giá shop đang để theo menu và {{shipText}} ạ. Nếu mình chốt nhiều món, nhân viên sẽ kiểm tra hỗ trợ mức tốt nhất trước khi lên đơn nhé.',
  officePickup: 'Dạ shop ưu tiên giao theo đơn để thuận tiện cho mình ạ. Mình gửi mẫu muốn lấy + thông tin nhận hàng, nhân viên sẽ xác nhận lại trước khi gửi nhé.',
  paymentPreorder: 'Dạ {{productCode}} là hàng đặt, nhân viên sẽ xác nhận thời gian và cách thanh toán rõ trước khi lên đơn ạ.',
  paymentDefault: 'Dạ bên em nhận hàng thanh toán ạ. Hàng che tên sản phẩm, gửi qua GHTK và có mã vận đơn theo dõi nhé.',
  deliveryPreorder: 'Dạ {{productCode}} là hàng đặt, thời gian về/giao khoảng {{preorderDays}} ạ. Nếu mình muốn mẫu có thể chốt nhanh hơn thì em gợi ý các mẫu không phải hàng đặt nhé.',
  deliveryDefault: 'Dạ bên em gửi Giao Hàng Tiết Kiệm. Sau khi lên đơn sẽ có mã vận đơn để mình theo dõi hành trình ạ.',
  returnPolicy: 'Dạ shop cần nhân viên xác nhận kỹ tình trạng đơn trước khi đổi trả hoặc xử lý lỗi. Mình giữ nguyên hình ảnh/video nhận hàng nếu có vấn đề để shop hỗ trợ nhanh ạ.',

  // ===== Tư vấn theo ngân sách / tính năng =====
  budgetTightCustom: 'Dạ với mức ngân sách khoảng 200k, em gợi ý mình xem các mẫu trong danh sách phù hợp phía trên ạ. Mình ưu tiên nhỏ gọn hay size lớn hơn để em lọc tiếp nhé?',
  budgetOptions: 'Dạ trong ngân sách khoảng {{budget}}k, mình có thể tham khảo:\n{{lines}}\nMình thích phân khúc nào hoặc có yêu cầu cụ thể để em lọc tiếp ạ?',
  budgetNoOptions: 'Dạ ngân sách khoảng {{budget}}k thì shop chưa có mẫu phù hợp trong danh sách hiện tại ạ. Mình có thể tăng ngân sách hoặc xem các mẫu gần mức đó trong menu nhé.',
  vibrationOptions: 'Dạ các mẫu có tính năng tương tự gồm {{options}}. Mình muốn xem ảnh mẫu nào ạ?',
  largeOptions: 'Dạ nếu mình thích mẫu kích thước lớn hơn thì có {{options}}. Mình muốn tầm giá nào để em tư vấn sát hơn ạ?',
  featureAdviceDefault: 'Dạ mình cho em biết ngân sách hoặc mẫu đang xem, em gợi ý 1–2 lựa chọn phù hợp trong menu nhé.',
  quietAdvice: 'Dạ nếu mình ưu tiên kín đáo/dễ cất thì nên chọn các mẫu nhỏ gọn như {{options}}. Shop vẫn gói kín, không ghi tên sản phẩm bên ngoài ạ.',

  // ===== Handoff =====
  humanHandoff: 'Dạ em chuyển mình qua nhân viên tư vấn hỗ trợ kỹ hơn nhé. Mình chờ một chút ạ 🙏',
  systemBusy: 'Xin lỗi mình, hệ thống đang bận. Mình thử lại sau nhé! 🙏'
};

const HELPERS = {
  upper: value => String(value || '').toUpperCase(),
  lower: value => String(value || '').toLowerCase(),
  capitalize: value => {
    const s = String(value || '');
    return s ? s[0].toUpperCase() + s.slice(1) : '';
  },
  default: (value, fallback) => (value == null || value === '' ? (fallback || '') : value),
  join: (value, sep = ', ') => Array.isArray(value) ? value.join(sep) : String(value || ''),
  vnd: value => {
    const s = String(value || '').trim();
    const m = s.match(/^(\d+)(?:\.(\d{3}))?k$/i);
    if (m) {
      const ng = m[2] ? Number(m[1]) * 1000 + Number(m[2]) : Number(m[1]);
      return `${ng.toLocaleString('vi-VN')}.000đ`;
    }
    const num = Number(s.replace(/[^\d]/g, ''));
    if (Number.isFinite(num) && num > 0) return `${num.toLocaleString('vi-VN')}đ`;
    return s;
  },
  count: (value, singular = '', plural = singular) => {
    const n = Array.isArray(value) ? value.length : Number(value);
    return `${n} ${n === 1 ? singular : plural}`;
  }
};

function applyHelper(value, expr) {
  const [name, ...args] = expr.split(':').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
  const fn = HELPERS[name];
  if (typeof fn !== 'function') return value;
  return fn(value, ...args);
}

function renderTemplate(template, data = {}) {
  if (template == null) return '';
  return String(template).replace(/\{\{\s*([\w.]+)((?:\s*\|\s*[^|}]+)*)\s*\}\}/g, (_, key, helperChain) => {
    let value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), data);

    if (helperChain) {
      const parts = helperChain.split('|').map(s => s.trim()).filter(Boolean);
      for (const helperExpr of parts) {
        value = applyHelper(value, helperExpr);
      }
    }
    return value == null ? '' : String(value);
  });
}

function render(name, data = {}, templates = TEMPLATES) {
  const tpl = templates[name];
  if (tpl == null) {
    console.warn(`[responses] Template không tồn tại: ${name}`);
    return '';
  }
  return renderTemplate(tpl, data);
}

module.exports = {
  TEMPLATES,
  HELPERS,
  renderTemplate,
  render
};
