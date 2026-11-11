export const knowledgeBase = {
  store: {
    name: 'Nerds Store',
    description:
      'Online technology store focused on accessories, peripherals and small electronics.',
    businessHours: 'Monday to Friday, 8:00 AM to 6:00 PM',
    supportEmail: 'support@nerdsstore.example',
  },

  shipping: {
    standard: '2 to 4 business days',
    express: '1 to 2 business days',
    freeShippingThreshold: 75,
    internationalShipping: false,
  },

  returns: {
    standardReturnWindowDays: 15,
    damagedProductWindowDays: 7,
    clearanceItemsReturnable: false,
    openedHeadphonesReturnable: false,
  },

  cancellations: {
    allowedBeforeShipping: true,
    allowedAfterShipping: false,
  },

  payments: {
    acceptedMethods: [
      'Visa',
      'Mastercard',
      'American Express',
      'PayPal',
    ],
    cashOnDelivery: false,
  },

  products: {
    'P-101': {
      name: 'Wireless Headphones X1',
      category: 'audio',
      price: 89.99,
      stock: 14,
      warrantyMonths: 12,
      colorOptions: ['black', 'white'],
    },

    'P-102': {
      name: 'Mechanical Keyboard K2',
      category: 'keyboards',
      price: 74.5,
      stock: 6,
      warrantyMonths: 24,
      switchType: 'red',
    },

    'P-103': {
      name: 'Gaming Mouse M5',
      category: 'mice',
      price: 39.99,
      stock: 0,
      warrantyMonths: 12,
      maxDpi: 12000,
    },

    'P-104': {
      name: 'USB-C Hub H7',
      category: 'accessories',
      price: 49.99,
      stock: 22,
      warrantyMonths: 12,
      ports: [
        'HDMI',
        'USB-C Power Delivery',
        '2x USB-A',
        'SD card',
      ],
    },

    'P-105': {
      name: 'Webcam C3',
      category: 'cameras',
      price: 64.99,
      stock: 9,
      warrantyMonths: 12,
      resolution: '1080p',
    },

    'P-106': {
      name: 'Laptop Stand S4',
      category: 'accessories',
      price: 29.99,
      stock: 18,
      warrantyMonths: 6,
      material: 'aluminum',
    },

    'P-107': {
      name: 'Bluetooth Speaker B2',
      category: 'audio',
      price: 54.99,
      stock: 3,
      warrantyMonths: 12,
      batteryHours: 10,
    },

    'P-108': {
      name: 'Clearance Wired Earphones E1',
      category: 'audio',
      price: 12.99,
      stock: 11,
      warrantyMonths: 3,
      clearance: true,
    },
  },

  orders: {
    '1001': {
      customerName: 'Mario',
      productId: 'P-101',
      status: 'shipped',
      shippingMethod: 'standard',
      carrier: 'DHL',
      trackingNumber: 'DHL-NS-1001',
    },

    '1002': {
      customerName: 'Andrea',
      productId: 'P-102',
      status: 'processing',
      shippingMethod: 'express',
      carrier: null,
      trackingNumber: null,
    },

    '1003': {
      customerName: 'Carlos',
      productId: 'P-103',
      status: 'delivered',
      shippingMethod: 'standard',
      carrier: 'FedEx',
      trackingNumber: 'FDX-NS-1003',
    },

    '1004': {
      customerName: 'Lucia',
      productId: 'P-104',
      status: 'delayed',
      shippingMethod: 'standard',
      carrier: 'DHL',
      trackingNumber: 'DHL-NS-1004',
      delayReason: 'Carrier operational delay',
    },

    '1005': {
      customerName: 'Daniel',
      productId: 'P-105',
      status: 'cancelled',
      shippingMethod: 'express',
      carrier: null,
      trackingNumber: null,
    },

    '1006': {
      customerName: 'Sofia',
      productId: 'P-107',
      status: 'ready_for_shipping',
      shippingMethod: 'standard',
      carrier: null,
      trackingNumber: null,
    },
  },

  support: {
    'P-101': [
      'Hold the power button for 3 seconds to turn on the headphones.',
      'If pairing fails, remove the device from Bluetooth settings and pair again.',
    ],

    'P-102': [
      'The keyboard uses red mechanical switches.',
      'It connects through USB-C.',
    ],

    'P-104': [
      'The HDMI port supports displays up to 4K at 30Hz.',
      'USB-C Power Delivery supports up to 100W input.',
    ],

    'P-105': [
      'The webcam supports 1080p video.',
      'It connects through USB-A.',
    ],

    'P-107': [
      'The speaker battery lasts up to 10 hours under normal use.',
      'Hold the Bluetooth button for 2 seconds to enter pairing mode.',
    ],
  },

  policies: {
    damagedItems:
      'Customers must report damaged products within 7 days of delivery.',

    warranty:
      'Warranty coverage depends on the individual product.',

    refunds:
      'Approved refunds are returned to the original payment method.',

    tracking:
      'Tracking information is available only after a carrier has been assigned.',
  },
} as const;
