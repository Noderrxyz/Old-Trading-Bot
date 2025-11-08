/**
 * Redis Client Interface
 * 
 * Defines the Redis client interface used by the strategy engine for
 * storing and retrieving performance metrics, decay scores, and other data.
 */

/**
 * Redis client interface for strategy engine components
 */
export interface RedisClient {
  /**
   * Set a key to a value
   * @param key Redis key
   * @param value Value to set
   * @param expiry Optional expiry in seconds
   */
  set(key: string, value: string, expiry?: number): Promise<void>;
  
  /**
   * Get a value by key
   * @param key Redis key
   * @returns Value or null if not found
   */
  get(key: string): Promise<string | null>;
  
  /**
   * Set multiple fields in a hash
   * @param key Redis key
   * @param fields Fields to set (object with field-value pairs)
   */
  hset(key: string, fields: Record<string, any>): Promise<void>;
  
  /**
   * Get all fields from a hash
   * @param key Redis key
   * @returns Object with field-value pairs or empty object if key not found
   */
  hgetall(key: string): Promise<Record<string, string>>;
  
  /**
   * Get specific fields from a hash
   * @param key Redis key
   * @param fields Fields to get
   * @returns Array of values
   */
  hmget(key: string, ...fields: string[]): Promise<(string | null)[]>;
  
  /**
   * Push a value to the left (head) of a list
   * @param key Redis key
   * @param value Value to push
   * @returns Length of the list after push
   */
  lpush(key: string, value: string): Promise<number>;
  
  /**
   * Push a value to the right (tail) of a list
   * @param key Redis key
   * @param value Value to push
   * @returns Length of the list after push
   */
  rpush(key: string, value: string): Promise<number>;
  
  /**
   * Get a range of values from a list
   * @param key Redis key
   * @param start Start index
   * @param stop End index
   * @returns Array of values
   */
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  
  /**
   * Trim a list to the specified range
   * @param key Redis key
   * @param start Start index
   * @param stop End index
   */
  ltrim(key: string, start: number, stop: number): Promise<void>;
  
  /**
   * Add a member to a set
   * @param key Redis key
   * @param member Member to add
   * @returns 1 if added, 0 if already exists
   */
  sadd(key: string, member: string): Promise<number>;
  
  /**
   * Remove a member from a set
   * @param key Redis key
   * @param member Member to remove
   * @returns 1 if removed, 0 if not a member
   */
  srem(key: string, member: string): Promise<number>;
  
  /**
   * Get all members of a set
   * @param key Redis key
   * @returns Array of members
   */
  smembers(key: string): Promise<string[]>;
  
  /**
   * Add a member to a sorted set with a score
   * @param key Redis key
   * @param score Score
   * @param member Member
   * @returns 1 if added, 0 if updated
   */
  zadd(key: string, score: number, member: string): Promise<number>;
  
  /**
   * Get members from a sorted set by rank range
   * @param key Redis key
   * @param min Min rank
   * @param max Max rank
   * @param options Additional options (by score, withscores, etc.)
   * @returns Array of members
   */
  zrange(key: string, min: string | number, max: string | number, ...options: any[]): Promise<string[] | any[]>;
  
  /**
   * Get the number of members in a sorted set
   * @param key Redis key
   * @returns Number of members
   */
  zcard(key: string): Promise<number>;
  
  /**
   * Remove members from a sorted set by rank range
   * @param key Redis key
   * @param min Min rank
   * @param max Max rank
   * @returns Number of members removed
   */
  zremrangebyrank(key: string, min: number, max: number): Promise<number>;
  
  /**
   * Get the length of a stream
   * @param key Redis key
   * @returns Length of the stream
   */
  xlen(key: string): Promise<number>;
  
  /**
   * Add an entry to a stream
   * @param key Redis key
   * @param id Entry ID (or '*' for auto-generated)
   * @param fields Fields to add
   * @returns ID of the added entry
   */
  xadd(key: string, id: string, fields: Record<string, string>): Promise<string>;
  
  /**
   * Trim a stream by minimum ID
   * @param key Redis key
   * @param minid Min ID to keep
   * @param id ID reference
   */
  xtrim(key: string, minid: string, id: string): Promise<void>;
  
  /**
   * Get a range of entries from a stream
   * @param key Redis key
   * @param start Start ID
   * @param end End ID
   * @param options Additional options (count, etc.)
   * @returns Array of entries
   */
  xrange(key: string, start: string, end: string, ...options: any[]): Promise<any[]>;
  
  /**
   * Set an expiry on a key
   * @param key Redis key
   * @param seconds Expiry in seconds
   * @returns 1 if set, 0 if key doesn't exist
   */
  expire(key: string, seconds: number): Promise<number>;
  
  /**
   * Delete a key
   * @param key Redis key
   * @returns 1 if deleted, 0 if key doesn't exist
   */
  del(key: string): Promise<number>;
  
  /**
   * Get all keys matching a pattern
   * @param pattern Pattern to match
   * @returns Array of matching keys
   */
  keys(pattern: string): Promise<string[]>;
}

/**
 * Create a mock Redis client for testing
 * @returns Mock Redis client
 */
export function createMockRedisClient(): RedisClient {
  const storage = new Map<string, any>();
  const hashes = new Map<string, Map<string, string>>();
  const lists = new Map<string, string[]>();
  const sets = new Map<string, Set<string>>();
  const sortedSets = new Map<string, Map<string, number>>();
  const streams = new Map<string, any[]>();
  const expirations = new Map<string, number>();
  
  return {
    async set(key: string, value: string, expiry?: number): Promise<void> {
      storage.set(key, value);
      if (expiry) {
        expirations.set(key, Date.now() + expiry * 1000);
      }
    },
    
    async get(key: string): Promise<string | null> {
      if (expirations.has(key) && Date.now() > expirations.get(key)!) {
        storage.delete(key);
        expirations.delete(key);
        return null;
      }
      return storage.get(key) || null;
    },
    
    async hset(key: string, fields: Record<string, any>): Promise<void> {
      if (!hashes.has(key)) {
        hashes.set(key, new Map());
      }
      
      const hash = hashes.get(key)!;
      for (const [field, value] of Object.entries(fields)) {
        hash.set(field, String(value));
      }
    },
    
    async hgetall(key: string): Promise<Record<string, string>> {
      if (!hashes.has(key)) {
        return {};
      }
      
      const hash = hashes.get(key)!;
      const result: Record<string, string> = {};
      
      for (const [field, value] of hash.entries()) {
        result[field] = value;
      }
      
      return result;
    },
    
    async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
      if (!hashes.has(key)) {
        return fields.map(() => null);
      }
      
      const hash = hashes.get(key)!;
      return fields.map(field => hash.get(field) || null);
    },
    
    async lpush(key: string, value: string): Promise<number> {
      if (!lists.has(key)) {
        lists.set(key, []);
      }
      
      const list = lists.get(key)!;
      list.unshift(value);
      
      return list.length;
    },
    
    async rpush(key: string, value: string): Promise<number> {
      if (!lists.has(key)) {
        lists.set(key, []);
      }
      
      const list = lists.get(key)!;
      list.push(value);
      return list.length;
    },
    
    async lrange(key: string, start: number, stop: number): Promise<string[]> {
      if (!lists.has(key)) {
        return [];
      }
      
      const list = lists.get(key)!;
      const actualStop = stop < 0 ? list.length + stop : stop;
      
      return list.slice(start, actualStop + 1);
    },
    
    async ltrim(key: string, start: number, stop: number): Promise<void> {
      if (!lists.has(key)) {
        return;
      }
      
      const list = lists.get(key)!;
      const actualStop = stop < 0 ? list.length + stop : stop;
      
      const newList = list.slice(start, actualStop + 1);
      lists.set(key, newList);
    },
    
    async sadd(key: string, member: string): Promise<number> {
      if (!sets.has(key)) {
        sets.set(key, new Set());
      }
      
      const set = sets.get(key)!;
      const alreadyExists = set.has(member);
      set.add(member);
      return alreadyExists ? 0 : 1;
    },
    
    async srem(key: string, member: string): Promise<number> {
      if (!sets.has(key)) {
        return 0;
      }
      
      const set = sets.get(key)!;
      const existed = set.has(member);
      set.delete(member);
      return existed ? 1 : 0;
    },
    
    async smembers(key: string): Promise<string[]> {
      if (!sets.has(key)) {
        return [];
      }
      
      return Array.from(sets.get(key)!.values());
    },
    
    async zadd(key: string, score: number, member: string): Promise<number> {
      if (!sortedSets.has(key)) {
        sortedSets.set(key, new Map());
      }
      
      const sortedSet = sortedSets.get(key)!;
      const isNew = !sortedSet.has(member);
      
      sortedSet.set(member, score);
      
      return isNew ? 1 : 0;
    },
    
    async zrange(key: string, min: string | number, max: string | number, ...options: any[]): Promise<string[]> {
      if (!sortedSets.has(key)) {
        return [];
      }
      
      const sortedSet = sortedSets.get(key)!;
      
      // Sort by score
      const entries = Array.from(sortedSet.entries())
        .sort((a, b) => a[1] - b[1]);
      
      // Get range
      const minIndex = typeof min === 'number' ? min : 0;
      const maxIndex = typeof max === 'number' ? max : entries.length - 1;
      
      return entries
        .slice(minIndex, maxIndex + 1)
        .map(entry => entry[0]);
    },
    
    async zcard(key: string): Promise<number> {
      if (!sortedSets.has(key)) {
        return 0;
      }
      
      return sortedSets.get(key)!.size;
    },
    
    async zremrangebyrank(key: string, min: number, max: number): Promise<number> {
      if (!sortedSets.has(key)) {
        return 0;
      }
      
      const sortedSet = sortedSets.get(key)!;
      
      // Sort by score
      const entries = Array.from(sortedSet.entries())
        .sort((a, b) => a[1] - b[1]);
      
      // Get range to remove
      const toRemove = entries.slice(min, max + 1);
      
      // Remove entries
      let removed = 0;
      for (const [member] of toRemove) {
        if (sortedSet.delete(member)) {
          removed++;
        }
      }
      
      return removed;
    },
    
    async xlen(key: string): Promise<number> {
      if (!streams.has(key)) {
        return 0;
      }
      
      return streams.get(key)!.length;
    },
    
    async xadd(key: string, id: string, fields: Record<string, string>): Promise<string> {
      if (!streams.has(key)) {
        streams.set(key, []);
      }
      
      const stream = streams.get(key)!;
      
      // Generate ID if '*'
      const actualId = id === '*' ? Date.now() + '-0' : id;
      
      stream.push({
        id: actualId,
        fields
      });
      
      return actualId;
    },
    
    async xtrim(key: string, minid: string, id: string): Promise<void> {
      if (!streams.has(key)) {
        return;
      }
      
      const stream = streams.get(key)!;
      
      // Keep only entries with ID >= id
      const newStream = stream.filter(entry => entry.id >= id);
      
      streams.set(key, newStream);
    },
    
    async xrange(key: string, start: string, end: string, ...options: any[]): Promise<any[]> {
      if (!streams.has(key)) {
        return [];
      }
      
      const stream = streams.get(key)!;
      
      // Filter by ID range
      const result = stream.filter(entry => {
        return (start === '-' || entry.id >= start) && (end === '+' || entry.id <= end);
      });
      
      // Check for COUNT option
      const countIndex = options.indexOf('COUNT');
      if (countIndex >= 0 && countIndex + 1 < options.length) {
        const count = parseInt(options[countIndex + 1], 10);
        return result.slice(0, count);
      }
      
      return result;
    },
    
    async expire(key: string, seconds: number): Promise<number> {
      if (storage.has(key) || hashes.has(key) || lists.has(key) || sortedSets.has(key) || streams.has(key)) {
        expirations.set(key, Date.now() + seconds * 1000);
        return 1;
      }
      
      return 0;
    },
    
    async del(key: string): Promise<number> {
      let deleted = 0;
      
      if (storage.delete(key)) deleted++;
      if (hashes.delete(key)) deleted++;
      if (lists.delete(key)) deleted++;
      if (sortedSets.delete(key)) deleted++;
      if (streams.delete(key)) deleted++;
      
      expirations.delete(key);
      
      return deleted;
    },
    
    async keys(pattern: string): Promise<string[]> {
      // Simple pattern matching implementation
      // Supports only * wildcard for simplicity in the mock
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      
      // Collect all keys from all data structures
      const allKeys: string[] = [
        ...Array.from(storage.keys()),
        ...Array.from(hashes.keys()),
        ...Array.from(lists.keys()),
        ...Array.from(sets.keys()),
        ...Array.from(sortedSets.keys()),
        ...Array.from(streams.keys())
      ];
      
      // Filter by pattern
      return allKeys.filter(key => regex.test(key));
    }
  };
} 