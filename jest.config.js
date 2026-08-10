module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  transform: {
    '^.+\\.[tj]sx?$': ['babel-jest', { configFile: './babel.config.test.js' }]
  },
  moduleNameMapper: {
    '\\.(css|scss)$': 'identity-obj-proxy',
    './styles/style': '<rootDir>/__mocks__/styleMock.js',
    './data/congestion.json': '<rootDir>/__mocks__/congestionMock.json',
  },
};
