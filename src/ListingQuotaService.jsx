import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';

// AWS Configuration
const REGION = "us-east-2";
const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";

// Initialize DynamoDB client
const dynamoDBClient = new DynamoDBClient({
  region: REGION,
  credentials: fromCognitoIdentityPool({
    clientConfig: { region: REGION },
    identityPoolId: IDENTITY_POOL_ID,
  }),
});

const docClient = DynamoDBDocumentClient.from(dynamoDBClient);

// Subscription tiers and their limits
export const SUBSCRIPTION_TIERS = {
  FREE: {
    name: 'Free',
    monthlyLimit: 10,
    isLifetime: true // Free tier is lifetime, not monthly
  },
  STANDARD: {
    name: 'Standard',
    monthlyLimit: 1000,
    isLifetime: false
  },
  GROWTH: {
    name: 'Growth',
    monthlyLimit: 10000,
    isLifetime: false
  }
};

class ListingQuotaService {
  constructor() {
    this.tableName = 'ListEasierUserQuotas';
  }

  /**
   * Get or create user quota record
   */
  async getUserQuota(userId) {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: { userId }
      });

      const response = await docClient.send(command);
      
      if (response.Item) {
        return response.Item;
      }

      // Create new user with free tier
      const newUserQuota = {
        userId,
        subscriptionTier: 'FREE',
        lifetimeListingsUsed: 0,
        monthlyListingsUsed: 0,
        currentMonth: this.getCurrentMonth(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await this.createUserQuota(newUserQuota);
      return newUserQuota;

    } catch (error) {
      console.error('Error getting user quota:', error);
      throw error;
    }
  }

  /**
   * Create a new user quota record
   */
  async createUserQuota(quotaData) {
    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: quotaData
      });

      await docClient.send(command);
      return quotaData;
    } catch (error) {
      console.error('Error creating user quota:', error);
      throw error;
    }
  }

  /**
   * Update user's listing count
   */
  async incrementListingCount(userId, count = 1) {
    const currentMonth = this.getCurrentMonth();

    try {
      // First get the current quota to check the month
      const userQuota = await this.getUserQuota(userId);
      
      // Reset monthly count if it's a new month (but not for lifetime/free tier)
      const isNewMonth = userQuota.currentMonth !== currentMonth;
      const isLifetimeTier = SUBSCRIPTION_TIERS[userQuota.subscriptionTier]?.isLifetime;

      const updateExpression = isNewMonth && !isLifetimeTier
        ? 'SET monthlyListingsUsed = :count, currentMonth = :month, lifetimeListingsUsed = lifetimeListingsUsed + :count, updatedAt = :updatedAt'
        : 'SET monthlyListingsUsed = monthlyListingsUsed + :count, lifetimeListingsUsed = lifetimeListingsUsed + :count, updatedAt = :updatedAt';

      const expressionValues = {
        ':count': count,
        ':updatedAt': new Date().toISOString()
      };

      if (isNewMonth && !isLifetimeTier) {
        expressionValues[':month'] = currentMonth;
      }

      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: { userId },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionValues,
        ReturnValues: 'ALL_NEW'
      });

      const response = await docClient.send(command);
      return response.Attributes;

    } catch (error) {
      console.error('Error incrementing listing count:', error);
      throw error;
    }
  }

  /**
   * Check if user can generate more listings
   */
  async canGenerateListings(userId, requestedCount = 1) {
    try {
      const userQuota = await this.getUserQuota(userId);
      const tier = SUBSCRIPTION_TIERS[userQuota.subscriptionTier] || SUBSCRIPTION_TIERS.FREE;
      
      // For lifetime tiers (free), check lifetime usage
      if (tier.isLifetime) {
        const remainingLifetime = tier.monthlyLimit - userQuota.lifetimeListingsUsed;
        return {
          allowed: remainingLifetime >= requestedCount,
          remaining: Math.max(0, remainingLifetime),
          limit: tier.monthlyLimit,
          isLifetime: true,
          tier: tier.name
        };
      }

      // For monthly tiers, check if we need to reset the counter
      const currentMonth = this.getCurrentMonth();
      const monthlyUsed = userQuota.currentMonth === currentMonth 
        ? userQuota.monthlyListingsUsed 
        : 0;

      const remaining = tier.monthlyLimit - monthlyUsed;

      return {
        allowed: remaining >= requestedCount,
        remaining: Math.max(0, remaining),
        limit: tier.monthlyLimit,
        isLifetime: false,
        tier: tier.name
      };

    } catch (error) {
      console.error('Error checking listing quota:', error);
      // Default to allowing if there's an error (fail open)
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        error: true
      };
    }
  }

  /**
   * Update user's subscription tier
   */
  async updateSubscriptionTier(userId, newTier) {
    if (!SUBSCRIPTION_TIERS[newTier]) {
      throw new Error(`Invalid subscription tier: ${newTier}`);
    }

    try {
      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: { userId },
        UpdateExpression: 'SET subscriptionTier = :tier, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':tier': newTier,
          ':updatedAt': new Date().toISOString()
        },
        ReturnValues: 'ALL_NEW'
      });

      const response = await docClient.send(command);
      return response.Attributes;

    } catch (error) {
      console.error('Error updating subscription tier:', error);
      throw error;
    }
  }

  /**
   * Get current month in YYYY-MM format
   */
  getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Get usage statistics for a user
   */
  async getUsageStats(userId) {
    try {
      const userQuota = await this.getUserQuota(userId);
      const tier = SUBSCRIPTION_TIERS[userQuota.subscriptionTier] || SUBSCRIPTION_TIERS.FREE;
      const currentMonth = this.getCurrentMonth();

      // Reset monthly count if needed
      const monthlyUsed = userQuota.currentMonth === currentMonth 
        ? userQuota.monthlyListingsUsed 
        : 0;

      const used = tier.isLifetime ? userQuota.lifetimeListingsUsed : monthlyUsed;
      const remaining = Math.max(0, tier.monthlyLimit - used);
      const percentageUsed = tier.monthlyLimit > 0 
        ? Math.round((used / tier.monthlyLimit) * 100) 
        : 0;

      return {
        tier: tier.name,
        used,
        remaining,
        limit: tier.monthlyLimit,
        percentageUsed,
        isLifetime: tier.isLifetime,
        lifetimeTotal: userQuota.lifetimeListingsUsed
      };

    } catch (error) {
      console.error('Error getting usage stats:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const listingQuotaService = new ListingQuotaService();