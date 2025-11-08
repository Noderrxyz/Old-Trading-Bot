import { ChainAdapterMock } from './mocks/ChainAdapterMock';

// Initialize mock chain adapters
const mockAdapters = {
  ethereum: new ChainAdapterMock('ethereum'),
  solana: new ChainAdapterMock('solana'),
  cosmos: new ChainAdapterMock('cosmos')
};

// Configure test environment
beforeAll(() => {
  // Set up any global test configuration here
});

afterAll(() => {
  // Clean up any resources after tests
});

export { mockAdapters }; 