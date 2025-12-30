// Verified contract addresses on Ethereum Mainnet
const CONTRACTS = {
  // Firepit contract - burns UNI and releases tokens from jar
  FIREPIT: '0x0d5cd355e2abeb8fb1552f56c965b867346d6721',
  
  // Token Jar - holds accumulated trading fees
  TOKEN_JAR: '0xf38521f130fccf29db1961597bc5d2b60f995f85',
  
  // UNI token - resource token to burn
  UNI_TOKEN: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  
  // Common tokens that accumulate in the jar
  USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  WBTC: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  PAXG: '0x45804880de22913dafe09f4980848ece6ecbaf78'
};

// Network configuration
const NETWORK = {
  MAINNET_CHAIN_ID: 1,
  NAME: 'Ethereum Mainnet'
};

// Security constants
const SECURITY = {
  MAX_RELEASE_LENGTH: 20, // From smart contract
  DEFAULT_SLIPPAGE_TOLERANCE: 0.5, // 0.5%
  GAS_BUFFER_MULTIPLIER: 1.2, // 20% buffer
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute
  RATE_LIMIT_MAX_REQUESTS: 30 // 30 requests per minute
};

module.exports = {
  CONTRACTS,
  NETWORK,
  SECURITY
};
