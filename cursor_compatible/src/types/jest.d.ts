/**
 * Global Jest type declarations
 */
declare global {
  namespace jest {
    function fn(): any;
    function fn<T extends (...args: any[]) => any>(implementation?: T): jest.MockInstance<ReturnType<T>, Parameters<T>>;
    function clearAllMocks(): void;
  }

  function describe(name: string, fn: () => void): void;
  function beforeEach(fn: () => void): void;
  function afterEach(fn: () => void): void;
  function beforeAll(fn: () => void): void;
  function afterAll(fn: () => void): void;
  function test(name: string, fn: () => void | Promise<void>): void;
  function it(name: string, fn: () => void | Promise<void>): void;
  
  // Mock expect functionality
  const expect: {
    (actual: any): {
      toBe(expected: any): void;
      toEqual(expected: any): void;
      toBeTruthy(): void;
      toBeFalsy(): void;
      toBeNull(): void;
      toBeUndefined(): void;
      toBeDefined(): void;
      toContain(expected: any): void;
      toHaveLength(expected: number): void;
      toHaveBeenCalled(): void;
      toHaveBeenCalledWith(...args: any[]): void;
      toHaveBeenCalledTimes(expected: number): void;
      not: {
        toBe(expected: any): void;
        toEqual(expected: any): void;
        toHaveBeenCalled(): void;
      };
    };
  };
}

export {}; 