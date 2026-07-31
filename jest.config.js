module.exports = {
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '\\.(css|scss)$': 'identity-obj-proxy',
    './styles/style': '<rootDir>/__mocks__/styleMock.js',
    './data/congestion.json': '<rootDir>/__mocks__/congestionMock.json',
  },
};
