// CacheService.jsx - Advanced Caching System for ListEasier
class CacheService {
    constructor() {
        this.cache = new Map();
        this.ttlMap = new Map();
        this.maxSize = 1000;
        this.hitCount = 0;
        this.missCount = 0;
        
        // Default TTL values (in milliseconds)
        this.defaultTTL = {
            categories: 24 * 60 * 60 * 1000,      // 24 hours - categories don't change often
            categoryFields: 12 * 60 * 60 * 1000,  // 12 hours - category fields are stable
            ebayPolicies: 60 * 60 * 1000,         // 1 hour - policies can be updated
            ebayCategories: 24 * 60 * 60 * 1000,  // 24 hours - eBay categories are stable
            userSessions: 30 * 60 * 1000,         // 30 minutes - user session data
            dynamodbResponses: 10 * 60 * 1000,    // 10 minutes - DynamoDB responses
            apiResponses: 5 * 60 * 1000           // 5 minutes - General API responses
        };

        // Start cleanup interval
        this.startCleanupInterval();
    }

    // Set cache item with TTL
    set(key, value, ttl = null, cacheType = 'default') {
        try {
            // Clean expired items if cache is getting full
            if (this.cache.size >= this.maxSize) {
                this.cleanup();
                
                // If still at max size after cleanup, remove oldest items
                if (this.cache.size >= this.maxSize) {
                    this.evictOldest(Math.floor(this.maxSize * 0.1)); // Remove 10% oldest
                }
            }

            const finalTTL = ttl || this.defaultTTL[cacheType] || this.defaultTTL.default;
            const expirationTime = Date.now() + finalTTL;
            
            // Store the value with metadata
            const cacheEntry = {
                value,
                createdAt: Date.now(),
                accessCount: 0,
                lastAccessed: Date.now(),
                cacheType
            };
            
            this.cache.set(key, cacheEntry);
            this.ttlMap.set(key, expirationTime);
            
            // Log cache operations in development
            if (process.env.NODE_ENV === 'development') {
                console.log(`Cache SET: ${key} (TTL: ${finalTTL}ms, Type: ${cacheType})`);
            }

            return true;
        } catch (error) {
            console.error('Cache set error:', error);
            return false;
        }
    }

    // Get cache item
    get(key) {
        try {
            const expiration = this.ttlMap.get(key);
            const now = Date.now();
            
            if (!expiration || now > expiration) {
                // Item expired
                this.cache.delete(key);
                this.ttlMap.delete(key);
                this.missCount++;
                
                if (process.env.NODE_ENV === 'development') {
                    console.log(`Cache MISS (expired): ${key}`);
                }
                
                return null;
            }

            const cacheEntry = this.cache.get(key);
            if (!cacheEntry) {
                this.missCount++;
                return null;
            }

            // Update access statistics
            cacheEntry.accessCount++;
            cacheEntry.lastAccessed = now;
            this.hitCount++;

            if (process.env.NODE_ENV === 'development') {
                console.log(`Cache HIT: ${key} (accessed ${cacheEntry.accessCount} times)`);
            }

            return cacheEntry.value;
        } catch (error) {
            console.error('Cache get error:', error);
            this.missCount++;
            return null;
        }
    }

    // Check if item exists and is valid
    has(key) {
        return this.get(key) !== null;
    }

    // Delete specific item
    delete(key) {
        const deleted = this.cache.delete(key);
        this.ttlMap.delete(key);
        
        if (process.env.NODE_ENV === 'development' && deleted) {
            console.log(`Cache DELETE: ${key}`);
        }
        
        return deleted;
    }

    // Clear all cache
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        this.ttlMap.clear();
        this.hitCount = 0;
        this.missCount = 0;
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`Cache CLEAR: Removed ${size} items`);
        }
    }

    // Clean up expired items
    cleanup() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [key, expiration] of this.ttlMap.entries()) {
            if (now > expiration) {
                this.cache.delete(key);
                this.ttlMap.delete(key);
                cleanedCount++;
            }
        }
        
        if (process.env.NODE_ENV === 'development' && cleanedCount > 0) {
            console.log(`Cache CLEANUP: Removed ${cleanedCount} expired items`);
        }
        
        return cleanedCount;
    }

    // Evict oldest items (LRU-style)
    evictOldest(count) {
        const entries = Array.from(this.cache.entries())
            .map(([key, entry]) => ({ key, ...entry }))
            .sort((a, b) => a.lastAccessed - b.lastAccessed)
            .slice(0, count);
        
        entries.forEach(({ key }) => {
            this.cache.delete(key);
            this.ttlMap.delete(key);
        });
        
        if (process.env.NODE_ENV === 'development' && entries.length > 0) {
            console.log(`Cache EVICT: Removed ${entries.length} oldest items`);
        }
    }

    // Start automatic cleanup interval
    startCleanupInterval() {
        // Clean up every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 5 * 60 * 1000);
    }

    // Stop cleanup interval
    stopCleanupInterval() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    // Get cache statistics
    getStats() {
        const totalRequests = this.hitCount + this.missCount;
        const hitRatio = totalRequests > 0 ? (this.hitCount / totalRequests * 100).toFixed(2) : 0;
        
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hitCount: this.hitCount,
            missCount: this.missCount,
            hitRatio: `${hitRatio}%`,
            totalRequests,
            memoryUsage: this.estimateMemoryUsage(),
            oldestItem: this.getOldestItem(),
            newestItem: this.getNewestItem()
        };
    }

    // Estimate memory usage
    estimateMemoryUsage() {
        let totalSize = 0;
        
        for (const [key, entry] of this.cache.entries()) {
            // Rough estimation of memory usage
            totalSize += key.length * 2; // Key size (UTF-16)
            totalSize += JSON.stringify(entry.value).length * 2; // Value size
            totalSize += 100; // Overhead for entry metadata
        }
        
        return `${(totalSize / 1024).toFixed(2)} KB`;
    }

    // Get oldest cached item
    getOldestItem() {
        let oldest = null;
        let oldestTime = Date.now();
        
        for (const [key, entry] of this.cache.entries()) {
            if (entry.createdAt < oldestTime) {
                oldestTime = entry.createdAt;
                oldest = { key, createdAt: entry.createdAt };
            }
        }
        
        return oldest;
    }

    // Get newest cached item
    getNewestItem() {
        let newest = null;
        let newestTime = 0;
        
        for (const [key, entry] of this.cache.entries()) {
            if (entry.createdAt > newestTime) {
                newestTime = entry.createdAt;
                newest = { key, createdAt: entry.createdAt };
            }
        }
        
        return newest;
    }

    // Category-specific cache methods
    getCategoryKey(category, subCategory) {
        return `category_fields_${category}_${subCategory}`;
    }

    setCategoryFields(category, subCategory, fields) {
        const key = this.getCategoryKey(category, subCategory);
        return this.set(key, fields, null, 'categoryFields');
    }

    getCategoryFields(category, subCategory) {
        const key = this.getCategoryKey(category, subCategory);
        return this.get(key);
    }

    // eBay policy cache methods
    getPolicyKey(userId, marketplace) {
        return `ebay_policies_${userId}_${marketplace}`;
    }

    setPolicyCache(userId, marketplace, policies) {
        const key = this.getPolicyKey(userId, marketplace);
        return this.set(key, policies, null, 'ebayPolicies');
    }

    getPolicyCache(userId, marketplace) {
        const key = this.getPolicyKey(userId, marketplace);
        return this.get(key);
    }

    // eBay category cache methods
    getEbayCategoryKey(categoryId) {
        return `ebay_category_${categoryId}`;
    }

    setEbayCategory(categoryId, categoryData) {
        const key = this.getEbayCategoryKey(categoryId);
        return this.set(key, categoryData, null, 'ebayCategories');
    }

    getEbayCategory(categoryId) {
        const key = this.getEbayCategoryKey(categoryId);
        return this.get(key);
    }

    // User session cache methods
    getUserSessionKey(userId, sessionId) {
        return `user_session_${userId}_${sessionId}`;
    }

    setUserSession(userId, sessionId, sessionData) {
        const key = this.getUserSessionKey(userId, sessionId);
        return this.set(key, sessionData, null, 'userSessions');
    }

    getUserSession(userId, sessionId) {
        const key = this.getUserSessionKey(userId, sessionId);
        return this.get(key);
    }

    // DynamoDB response cache methods
    getDynamoDBKey(tableName, query) {
        // Create a deterministic key from table name and query parameters
        const queryHash = btoa(JSON.stringify(query)).replace(/[/+=]/g, '');
        return `dynamodb_${tableName}_${queryHash}`;
    }

    setDynamoDBResponse(tableName, query, response) {
        const key = this.getDynamoDBKey(tableName, query);
        return this.set(key, response, null, 'dynamodbResponses');
    }

    getDynamoDBResponse(tableName, query) {
        const key = this.getDynamoDBKey(tableName, query);
        return this.get(key);
    }

    // Batch operations
    setMultiple(items) {
        const results = [];
        
        for (const { key, value, ttl, cacheType } of items) {
            results.push({
                key,
                success: this.set(key, value, ttl, cacheType)
            });
        }
        
        return results;
    }

    getMultiple(keys) {
        const results = {};
        
        for (const key of keys) {
            results[key] = this.get(key);
        }
        
        return results;
    }

    // Cache warming - preload frequently accessed data
    async warmCache(warmingConfig) {
        const results = [];
        
        for (const config of warmingConfig) {
            try {
                const { key, loader, ttl, cacheType } = config;
                
                // Check if already cached
                if (!this.has(key)) {
                    const data = await loader();
                    const success = this.set(key, data, ttl, cacheType);
                    results.push({ key, success, action: 'loaded' });
                } else {
                    results.push({ key, success: true, action: 'already_cached' });
                }
            } catch (error) {
                console.error(`Cache warming failed for key: ${config.key}`, error);
                results.push({ key: config.key, success: false, error: error.message });
            }
        }
        
        return results;
    }

    // Export cache data for persistence
    exportCache() {
        const exportData = {
            timestamp: Date.now(),
            entries: [],
            stats: this.getStats()
        };
        
        for (const [key, entry] of this.cache.entries()) {
            const expiration = this.ttlMap.get(key);
            
            exportData.entries.push({
                key,
                value: entry.value,
                createdAt: entry.createdAt,
                expiresAt: expiration,
                cacheType: entry.cacheType,
                accessCount: entry.accessCount
            });
        }
        
        return exportData;
    }

    // Import cache data from persistence
    importCache(importData) {
        if (!importData || !importData.entries) {
            return false;
        }
        
        const now = Date.now();
        let importedCount = 0;
        
        for (const entry of importData.entries) {
            // Only import non-expired entries
            if (entry.expiresAt > now) {
                const cacheEntry = {
                    value: entry.value,
                    createdAt: entry.createdAt,
                    accessCount: entry.accessCount || 0,
                    lastAccessed: now,
                    cacheType: entry.cacheType
                };
                
                this.cache.set(entry.key, cacheEntry);
                this.ttlMap.set(entry.key, entry.expiresAt);
                importedCount++;
            }
        }
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`Cache IMPORT: Imported ${importedCount} items`);
        }
        
        return importedCount;
    }
}

// Create and export global cache instance
export const cacheService = new CacheService();

// Clean up on page unload
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        cacheService.stopCleanupInterval();
    });
}

export default CacheService;