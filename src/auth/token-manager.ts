/**
 * Secure token storage and management
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../utils/logger.js';
import { TokenStorage, OAuthTokens } from '../core/types.js';
import { ConfigurationError } from '../core/errors.js';

const logger = createLogger('TokenManager');

export class TokenManager {
  private readonly tokenDir: string;
  private readonly tokenFile: string;
  
  constructor(customPath?: string) {
    if (customPath) {
      this.tokenDir = customPath;
      this.tokenFile = path.join(customPath, 'tokens.json');
    } else {
      this.tokenDir = path.join(os.homedir(), '.config', 'mcp-tiktok');
      this.tokenFile = path.join(this.tokenDir, 'tokens.json');
    }
  }

  /**
   * Initialize token directory with secure permissions
   */
  public initialize(): void {
    try {
      // Create directory with restricted permissions (owner only)
      if (!fs.existsSync(this.tokenDir)) {
        fs.mkdirSync(this.tokenDir, { 
          recursive: true, 
          mode: 0o700  // drwx------
        });
        logger.info('Token directory created', { path: this.tokenDir });
      }
    } catch (error) {
      throw new ConfigurationError(`Failed to create token directory: ${error}`);
    }
  }

  /**
   * Store tokens securely
   */
  public async storeTokens(tokens: OAuthTokens, openId: string): Promise<void> {
    this.initialize();

    // Calculate expiry timestamp in seconds (Unix timestamp)
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = tokens.expires_in ? now + tokens.expires_in : now + 3600; // Default to 1 hour if not specified

    const storage: TokenStorage = {
      ...tokens,
      open_id: openId,
      client_key: process.env.TIKTOK_CLIENT_KEY || '',
      expires_at: expiresAt,
      created_at: now,
    };

    try {
      // Write with restricted permissions (owner read/write only)
      fs.writeFileSync(
        this.tokenFile,
        JSON.stringify(storage, null, 2),
        { mode: 0o600 }  // -rw-------
      );
      logger.info('Tokens stored successfully');
    } catch (error) {
      throw new ConfigurationError(`Failed to store tokens: ${error}`);
    }
  }

  /**
   * Retrieve stored tokens
   */
  public async getTokens(): Promise<TokenStorage | null> {
    try {
      if (!fs.existsSync(this.tokenFile)) {
        logger.debug('No token file found');
        return null;
      }

      const content = fs.readFileSync(this.tokenFile, 'utf-8');
      const storage: TokenStorage = JSON.parse(content);
      
      // Remove client_key from returned tokens (security)
      const { client_key, ...safeTokens }: Omit<TokenStorage, 'client_key'> & Pick<TokenStorage, 'client_key'> = storage;
      return {
        ...safeTokens,
        client_key: '', // Empty string to satisfy type requirement but not expose actual key
      } as TokenStorage;
    } catch (error) {
      logger.error('Failed to read tokens', { error });
      return null;
    }
  }

  /**
   * Check if token has expired
   */
  public async isTokenExpired(): Promise<boolean> {
    const tokens = await this.getTokens();
    if (!tokens || !tokens.expires_at) {
      return true;
    }
    
    // Convert current time to seconds and add 60 second buffer
    const now = Math.floor(Date.now() / 1000);
    const expiredAt = tokens.expires_at - 60;
    return now > expiredAt;
  }

  /**
   * Delete stored tokens (logout)
   */
  public async deleteTokens(): Promise<void> {
    try {
      if (fs.existsSync(this.tokenFile)) {
        fs.unlinkSync(this.tokenFile);
        logger.info('Tokens deleted successfully');
      }
    } catch (error) {
      throw new ConfigurationError(`Failed to delete tokens: ${error}`);
    }
  }

  /**
   * Get token file path (for debugging)
   */
  public getTokenFilePath(): string {
    return this.tokenFile;
  }
}

// Export singleton instance
export const tokenManager = new TokenManager();
