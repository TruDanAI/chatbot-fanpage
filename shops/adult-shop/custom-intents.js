const { detectors } = require('../../core/rules');

/**
 * Intent đặc thù shop 18+: tuổi, gel, rung/pin.
 * Ghép vào config qua config.intents.prepend trong index.js.
 */
function wantsExperienceAdvice(ctx) {
  const t = ctx.normalized || '';
  return /\b(?:suong|phe|cam\s*giac|chan\s*that|that\s*khong|dung\s*(?:co\s*)?(?:on|thich|da)|co\s*(?:suong|phe)|da\s*(?:khong|ko|k))\b/.test(t);
}

module.exports = {
  prepend: [
    {
      name: 'AGE_POLICY',
      match: ctx => detectors.wantsAgePolicy(ctx.text),
      handle: ctx => ctx.render('agePolicy', {
        shopName: ctx.config.shopName,
        minAge: ctx.config.minAge
      })
    },
    {
      name: 'GEL_KEYWORD',
      match: ctx => ctx.mentionsKeyword('gel') && !detectors.isOrderIntent(ctx.text),
      handle: ctx => ctx.render('gelInfo')
    },
    {
      name: 'EXPERIENCE_ADVICE',
      match: ctx => wantsExperienceAdvice(ctx),
      handle: ctx => {
        if (ctx.selectedProduct) {
          return ctx.render('experienceAdviceSelected', {
            productCode: ctx.selectedProduct.code
          });
        }
        return ctx.render('experienceAdviceDefault', {
          options: [
            ...ctx.recommendationProducts('vibration').slice(0, 2),
            ...ctx.recommendationProducts('budget').slice(0, 1)
          ]
            .map(p => `${p.code} giá ${p.price}`)
            .join(', ')
        });
      }
    },
    {
      name: 'VIBRATION',
      match: ctx => ctx.wantsVibration,
      handle: ctx => ctx.render('vibrationOptions', {
        options: ctx.recommendationProducts('vibration')
          .map(p => `${p.code} giá ${p.price}`)
          .join(' và ')
          || 'một số mẫu có rung'
      })
    }
  ]
};
