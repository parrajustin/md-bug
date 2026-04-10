/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^standard-ts-lib/(.*)$': '<rootDir>/../../standard-ts-lib/$1'
  },
  setupFiles: ['<rootDir>/jest.setup.ts']
};
