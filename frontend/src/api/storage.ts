import { WrapPromise } from 'standard-ts-lib/src/wrap_promise';
import { type Result, type StatusResult, Ok } from 'standard-ts-lib/src/result';
import { type Optional, WrapOptional } from 'standard-ts-lib/src/optional';
import { StatusError } from 'standard-ts-lib/src/status_error';

const DB_NAME = 'md-bug-db';
const STORE_NAME = 'settings';
const USERNAME_KEY = 'username';

export class Storage {
  private db: IDBDatabase | null = null;

  private async getDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  async getUsername(): Promise<Result<Optional<string>, StatusError>> {
    return WrapPromise(
      this.getDb().then((db) => {
        return new Promise<Optional<string>>((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, 'readonly');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.get(USERNAME_KEY);

          request.onsuccess = () => resolve(WrapOptional(request.result as string | null));
          request.onerror = () => reject(request.error);
        });
      }),
      'Failed to get username from storage'
    );
  }

  async setUsername(username: string): Promise<StatusResult<StatusError>> {
    return WrapPromise(
      this.getDb().then((db) => {
        return new Promise<unknown>((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.put(username, USERNAME_KEY);

          request.onsuccess = () => resolve(Ok());
          request.onerror = () => reject(request.error);
        });
      }),
      'Failed to set username in storage'
    );
  }
}

export const storage = new Storage();
