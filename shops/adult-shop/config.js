// Cấu hình shop adult-shop — đồ chơi người lớn (tách khỏi core).

module.exports = {
  shopName: 'shop',
  minAge: 18,

  botMode: {
    name: 'menu_code_handoff',
    aiFallbackEnabled: false,
    orderFlowEnabled: false,
    leadCaptureEnabled: false,
    followUpEnabled: false,
    recommendationEnabled: false,
    productCodeLookupEnabled: true,
    menuSendingEnabled: true,
    handoffMessage: [
      'E gửi anh xem qua sp, anh ưng mã nào em tư vấn ạ',
      'Bên em nhận hàng thanh toán, che tên sản phẩm trước khi gửi đi.',
      'Freeship + tặng gel',
      'Có kèm mã vận đơn để anh theo dõi hành trình của đơn hàng anh nhé. Bên em giao bằng đơn vị Giao Hàng Tiết Kiệm.'
    ].join('\n')
  },

  policies: {
    freeShipping: true,
    privacy: 'che tên sản phẩm trước khi gửi đi',
    payment: 'nhận hàng thanh toán',
    preorderDays: '15-20 ngày',
    orderInfoFields: 'tên người nhận + SĐT + địa chỉ giao hàng'
  },

  recommendations: {
    budget: ['MÃ10', 'MÃ2', 'MÃ3'],
    vibration: ['MÃ2', 'MÃ8'],
    large: ['MÃ9', 'MÃ12', 'MÃ13'],
    premium: ['MÃ8', 'MÃ12', 'MÃ13']
  },

  hotCarouselProductCodes: ['MÃ8', 'MÃ10', 'MÃ2', 'MÃ13', 'Gel bôi trơn'],

  keywordProducts: {
    gel: /gel/i
  },

  keywordTriggers: {
    gel: t =>
      /\bgel\b/.test(t)
      || /\bboi\s*tron\b/.test(t)
      || /\blub(?:ricant)?\b/.test(t)
  },

  wantsVibration: t => /\brung\b|co\s*pin|sac\s*pin/.test(t),

  productPitch(product) {
    if (String(product?.code || '').toUpperCase() === 'MÃ7') {
      return 'form khá mềm và chân thật';
    }
    return '';
  },

  productImageExtraNames(product) {
    const code = String(product?.code || '');
    if (/gel/i.test(code)) {
      return ['goi gel boi tron', 'goi-gel-boi-tron', 'gel boi tron', 'gel-boi-tron'];
    }
    return [];
  },

  /**
   * System prompt Gemini — giữ giọng và quy tắc riêng shop.
   */
  buildSystemPrompt(products) {
    const lines = products.map(p => {
      const parts = [
        p.code,
        p.price,
        p.description,
        p.size,
        p.weight,
        p.gift ? `Tặng ${p.gift}` : '',
        p.preorder ? 'HÀNG ĐẶT 15-20 ngày' : ''
      ].filter(Boolean);
      return `- ${parts.join(' | ')}`;
    }).join('\n');

    return `Bạn là nhân viên tư vấn bán hàng thân thiện, nhiệt tình của Shop đồ chơi người lớn dành cho nam giới (18+). Hãy tư vấn tự nhiên, gần gũi như người thật, dùng ngôn ngữ thoải mái, không quá formal.

DANH SÁCH SẢN PHẨM:
${lines}

CHÍNH SÁCH:
- Freeship + tặng gel theo từng mã
- Che tên sản phẩm trước khi gửi đi
- Giao bằng Giao Hàng Tiết Kiệm, có mã vận đơn để khách theo dõi
- Hàng đặt giao 15-20 ngày, nhân viên xác nhận thanh toán trước khi lên đơn
- Thanh toán: nhận hàng thanh toán

QUY TẮC BẮT BUỘC:
- TUYỆT ĐỐI không bịa sản phẩm hoặc giá ngoài danh sách trên
- Nếu khách hỏi sản phẩm không có, nói thẳng "shop chưa có" rồi gợi ý mẫu gần nhất
- Trả lời ngắn gọn, tự nhiên, giống nhân viên chat fanpage. KHÔNG liệt kê dài dòng trừ khi khách hỏi hết danh sách
- Khi greeting, ưu tiên gửi menu ảnh và câu mời khách chọn mã
- Khi khách hỏi mẫu hot/bán chạy/nhiều người hỏi, gửi carousel ảnh kèm câu: "🔥 Mấy mẫu này đang được hỏi nhiều nhất hôm nay nha mình 😄"
- Khi khách hỏi ship/thanh toán/bảo mật, nói ngắn: "Bên em nhận hàng thanh toán, che tên sản phẩm trước khi gửi. Freeship + tặng gel, gửi GHTK có mã vận đơn theo dõi"
- Dùng emoji vừa phải cho thân thiện
- Ngôn ngữ kín đáo, không phản cảm
- Chỉ tư vấn cho khách đủ 18 tuổi
- Xưng hô nhất quán **mình** — không dùng cách xưng hô khác, không lẫn ngôi.
- KHÔNG nhắc khách về kỹ thuật hay nội bộ: cấm các cụm như "hệ thống tự động", "AI", "bot". Không dùng ngoặc đơn/ngoặc vuông để giải thích cơ chế gửi tin hay ảnh.
- Tuyệt đối không viết placeholder như "[ảnh menu sẽ được gửi kèm]", "[Ảnh sản phẩm ở đây]", "(ảnh được gửi...)" hoặc mô tả hành động gửi ảnh trong ngoặc.
- Ảnh/menu có thể được gửi **kèm tin nhắn của em** sau khi em trả lời; đừng tiết lộ chi tiết đó. Không nói "em không gửi ảnh được" hay xin lỗi vì ảnh — cứ tự nhiên như "em gửi mình xem qua mẫu nhé" hoặc "mình xem các mã trong menu ạ".
- Ưu tiên 1-3 câu ngắn như đang inbox bình thường; chỉ hỏi 1 câu tiếp theo, không mở bài dài.

CÁCH TƯ VẤN:
- Nếu khách chưa rõ nhu cầu: hỏi ngân sách, thích nhỏ gọn hay to, có pin/rung không
- Gợi ý 1-2 sản phẩm phù hợp ngân sách, không spam cả danh sách
- Khi khách muốn chốt đơn: hỏi tên + địa chỉ + số điện thoại
- Khi đã đủ thông tin: xác nhận lại sản phẩm + giá + tên + sđt + địa chỉ trước khi kết thúc
- Nếu khách muốn gặp nhân viên thật: trả lời "Em chuyển mình qua nhân viên tư vấn nhé" và dừng tư vấn`;
  },

  intents: {},

  templates: {
    gelInfo:
      'Dạ gel bên em 150k/chai 200ml, mua gel tặng thêm 5 gói nhỏ ạ.',
    agePolicy:
      'Dạ sản phẩm bên {{shopName}} chỉ tư vấn và bán cho khách từ đủ {{minAge}} tuổi trở lên ạ. Nếu mình đã đủ {{minAge}} tuổi thì em hỗ trợ tư vấn bình thường nhé.',
    experienceAdviceDefault:
      'Dạ tuỳ mã và nhu cầu của mình ạ 😄 Mẫu mềm/ôm thì cảm giác thật hơn, mẫu có rung thì kích thích hơn. Mình thích nhỏ gọn dễ dùng hay có rung mạnh hơn để em gợi ý đúng mã nha?\n\nMình có thể xem nhanh {{options}} ạ.',
    experienceAdviceSelected:
      'Dạ {{productCode}} thiên về cảm giác thoải mái theo mô tả sản phẩm ạ. Nếu mình muốn rõ hơn thì em tư vấn thêm theo nhu cầu: nhỏ gọn dễ dùng, mềm/chân thật, hay có rung mạnh hơn nha.',
    budgetTightCustom:
      'Dạ tầm 200k thì gần nhất là MÃ10 giá 150k, nhỏ gọn không rung. Có rung thì mình xem MÃ2 giá 300k ạ.',
    budgetOptions:
      'Dạ có nha mình 😄 Tầm {{budgetLabel}} bên em có vài mẫu nhỏ gọn với dễ dùng lắm ạ.\n\nĐể em gửi mình mấy mẫu đang được hỏi nhiều trong tầm giá này nha 👌\n{{lines}}',
    featureAdviceDefault:
      'Dạ em gợi ý nhanh: tiết kiệm MÃ10 150k, có rung MÃ2 300k, cao cấp MÃ8 680k. Mình muốn tầm giá nào ạ?',
    bestSeller:
      '🔥 Mấy mẫu này đang được hỏi nhiều nhất hôm nay nha mình 😄',
    fitInfo:
      'Dạ {{productCode}} chất liệu mềm và thiết kế ôm/khít theo mô tả sản phẩm ạ. Khi dùng mình có thể dùng thêm gel bôi trơn để thoải mái hơn, shop có gel nếu mình cần kèm theo nhé.',
    discount:
      'Dạ giá bên em theo menu và freeship ạ. Chốt nhiều món nhân viên sẽ kiểm tra hỗ trợ thêm cho mình nhé.',
    inspection:
      'Dạ hàng bên em che tên sản phẩm trước khi gửi. Nhận hàng mình kiểm tra gói bên ngoài giúp em nhé.',
    officePickup:
      'Dạ bên em ưu tiên giao GHTK cho kín đáo ạ. Có mã vận đơn để mình theo dõi hành trình nhé.',
    returnPolicy:
      'Dạ vì đây là sản phẩm cá nhân/nhạy cảm nên shop cần nhân viên xác nhận kỹ tình trạng đơn trước khi đổi trả hoặc xử lý lỗi. Mình giữ nguyên hình ảnh/video nhận hàng nếu có vấn đề để shop hỗ trợ nhanh ạ.',
    cleaningInfo:
      'Dạ vệ sinh được ạ. Sau khi dùng mình rửa nhẹ bằng nước sạch hoặc dung dịch vệ sinh chuyên dụng, lau khô rồi để nơi thoáng mát; tránh ngâm phần pin/sạc nếu mẫu có điện ạ.'
  },

  fallbackReply:
    'Dạ mình nhắn em mã sản phẩm hoặc tầm giá muốn xem, em gợi ý nhanh cho mình nha 😄'
};
