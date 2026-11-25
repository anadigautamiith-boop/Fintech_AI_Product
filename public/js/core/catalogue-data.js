// Synthetic catalogue. Every merchant, item and price here is invented.
// Names are fictional on purpose: this is a simulation and implies no
// relationship with any real shop, app or payment provider.
//
// `verified: false` marks a look-alike shop that appears in search results,
// the way scam stores do. The policy engine treats it as unknown.

export const CATALOGUE = {
  version: '2026-11-25',

  categories: {
    groceries: {
      label: 'Groceries',
      reversible: true,
      undoWindowMin: 15,
      aliases: ['groceries', 'grocery', 'ration', 'kirana', 'vegetables', 'veggies', 'fruit', 'fruits', 'milk', 'provisions'],
    },
    food_delivery: {
      label: 'Food delivery',
      reversible: true,
      undoWindowMin: 3,
      aliases: ['food delivery', 'food', 'restaurant', 'restaurants', 'takeaway', 'dinner', 'lunch', 'meals', 'food orders'],
    },
    mobile_recharge: {
      label: 'Mobile recharge',
      reversible: false,
      undoWindowMin: 0,
      aliases: ['mobile recharge', 'recharge', 'recharges', 'top up', 'top-up', 'topup', 'prepaid'],
    },
    general_merchandise: {
      label: 'Shopping marketplace',
      reversible: true,
      undoWindowMin: 60,
      aliases: ['shopping', 'marketplace', 'general merchandise', 'gadgets', 'accessories'],
    },
  },

  merchants: {
    freshbasket: { name: 'FreshBasket', category: 'groceries', verified: true, aliases: ['freshbasket', 'fresh basket'] },
    quickmart: { name: 'QuickMart', category: 'groceries', verified: true, aliases: ['quickmart', 'quick mart'] },
    spiceroute: { name: 'SpiceRoute Kitchen', category: 'food_delivery', verified: true, aliases: ['spiceroute', 'spice route', 'spiceroute kitchen'] },
    biryanilane: { name: 'Biryani Lane', category: 'food_delivery', verified: true, aliases: ['biryanilane', 'biryani lane'] },
    teletop: { name: 'TeleTop Recharge', category: 'mobile_recharge', verified: true, aliases: ['teletop', 'tele top', 'teletop recharge'] },
    bazaarhub: { name: 'BazaarHub', category: 'general_merchandise', verified: true, marketplace: true, aliases: ['bazaarhub', 'bazaar hub'] },
    // Look-alike of FreshBasket. Not verified.
    freshbaskett: { name: 'FreshBaskett', category: 'groceries', verified: false, aliases: ['freshbaskett'] },
  },

  items: {
    'FB-MILK': { merchantId: 'freshbasket', name: 'Toned milk, 1 L', price: 56, listing: 'Toned milk in a 1 litre pack. Delivered cold.' },
    'FB-ATTA': { merchantId: 'freshbasket', name: 'Atta, 5 kg', price: 285, listing: 'Whole wheat flour, 5 kg bag.' },
    'FB-RICE': { merchantId: 'freshbasket', name: 'Basmati rice, 5 kg', price: 620, listing: 'Aged basmati rice, 5 kg bag.' },
    'FB-DAL': { merchantId: 'freshbasket', name: 'Toor dal, 1 kg', price: 165, listing: 'Split pigeon peas, 1 kg pack.' },
    'FB-OIL': { merchantId: 'freshbasket', name: 'Sunflower oil, 1 L', price: 148, listing: 'Refined sunflower oil, 1 litre pouch.' },
    'FB-EGGS': { merchantId: 'freshbasket', name: 'Eggs, 12', price: 84, listing: 'Farm eggs, tray of 12.' },
    'FB-VEG': { merchantId: 'freshbasket', name: 'Vegetable box', price: 399, listing: 'Seasonal vegetables, about 5 kg.' },
    'FB-GIFT': { merchantId: 'freshbasket', name: 'FreshBasket gift card', price: 1000, listing: 'Gift card, valid on FreshBasket.' },

    'QM-MILK': { merchantId: 'quickmart', name: 'Toned milk, 1 L', price: 58, listing: 'Toned milk, 1 litre pack.' },
    'QM-ATTA': { merchantId: 'quickmart', name: 'Atta, 5 kg', price: 295, listing: 'Whole wheat flour, 5 kg bag.' },
    'QM-BREAD': { merchantId: 'quickmart', name: 'Bread loaf', price: 45, listing: 'Sliced white bread, 400 g.' },
    'QM-BANANA': { merchantId: 'quickmart', name: 'Bananas, 1 dozen', price: 70, listing: 'Ripe bananas, one dozen.' },
    'QM-SNACK': { merchantId: 'quickmart', name: 'Snack box', price: 249, listing: 'Assorted snacks, family pack.' },
    'QM-VEG': { merchantId: 'quickmart', name: 'Vegetable box', price: 419, listing: 'Seasonal vegetables, about 5 kg.' },
    'QM-EGGS': { merchantId: 'quickmart', name: 'Eggs, 12', price: 88, listing: 'Farm eggs, tray of 12.' },

    'SR-THALI': { merchantId: 'spiceroute', name: 'Veg thali', price: 249, listing: 'Dal, two sabzis, rice, roti and sweet.' },
    'SR-PANEER': { merchantId: 'spiceroute', name: 'Paneer butter masala with naan', price: 329, listing: 'Paneer in tomato gravy with two naan.' },
    'SR-BIRYANI': { merchantId: 'spiceroute', name: 'Chicken biryani', price: 349, listing: 'Chicken biryani with raita.' },
    'SR-COMBO': { merchantId: 'spiceroute', name: 'Family combo', price: 899, listing: 'Serves four: mains, breads and dessert.' },
    'SR-DESSERT': { merchantId: 'spiceroute', name: 'Gulab jamun, 4 pieces', price: 99, listing: 'Warm gulab jamun.' },

    'BL-BIRYANI': { merchantId: 'biryanilane', name: 'Chicken biryani', price: 329, listing: 'Dum chicken biryani.' },
    'BL-KEBAB': { merchantId: 'biryanilane', name: 'Seekh kebab platter', price: 279, listing: 'Six seekh kebabs with chutney.' },
    'BL-FAMILY': { merchantId: 'biryanilane', name: 'Family feast', price: 1199, listing: 'Serves five: biryani, kebabs and sides.' },

    'TT-399': { merchantId: 'teletop', name: 'Prepaid recharge, 28 days', price: 399, listing: 'Prepaid plan, 28 days.' },
    'TT-799': { merchantId: 'teletop', name: 'Prepaid recharge, 84 days', price: 799, listing: 'Prepaid plan, 84 days.' },

    'BH-CHARGER': { merchantId: 'bazaarhub', name: 'USB charger', price: 499, seller: 'Metro Electricals', listing: 'Fast charger, 20 W.' },
    'BH-EARBUDS': { merchantId: 'bazaarhub', name: 'Wireless earbuds', price: 1299, seller: 'QuickDealz', listing: 'Bluetooth earbuds with charging case.' },
    'BH-GIFT5000': { merchantId: 'bazaarhub', name: 'Gift card, 5,000', price: 5000, seller: 'GiftZone', listing: 'Gift card valid on BazaarHub.' },

    'FK-ATTA': { merchantId: 'freshbaskett', name: 'Atta, 5 kg', price: 199, listing: 'Whole wheat flour, 5 kg bag. Lowest price.' },
    'FK-RICE': { merchantId: 'freshbaskett', name: 'Basmati rice, 5 kg', price: 449, listing: 'Basmati rice, 5 kg bag. Lowest price.' },
    'FK-MILK': { merchantId: 'freshbaskett', name: 'Toned milk, 1 L', price: 39, listing: 'Toned milk, 1 litre pack. Lowest price.' },
  },
};

export default CATALOGUE;
