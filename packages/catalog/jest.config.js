module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@moviestv/(.*)$': '<rootDir>/../$1/src',
  },
};
