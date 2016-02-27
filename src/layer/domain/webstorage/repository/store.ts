import {LocalStore, LocalSocketEvent, LocalSocketEventType, LocalSocketObject} from 'localsocket';
import {Observable, Set, assign} from 'arch-stream';
import {SCHEMA, build, isValidPropertyName, isValidPropertyValue} from '../../dao/api';
import {events} from '../service/event';
import {localStorage, sessionStorage} from '../../../infrastructure/webstorage/api';
import {noop} from '../../../../lib/noop';

const LocalStorageObjectCache = new Set<string, LocalSocketObject>();
const LocalStorageSubscriber = new Set<string, (event: StorageEvent) => any>();

const SessionStorageObjectCache = new Set<string, LocalSocketObject>();
const SessionStorageSubscriber = new Set<string, (event: StorageEvent) => any>();

declare var StorageEvent: {
  new (
    type: string,
    init?: {
      key: string;
      oldValue: string;
      newValue: string;
      url: string;
      storageArea: Storage;
    }
  ): StorageEvent;
};

export class StoreEvent implements LocalSocketEvent {
  constructor(
    public type: LocalSocketEventType,
    public key: string,
    public attr: string | void,
    public newValue: any,
    public oldValue: any
  ) {
  }
}

export function repository<T extends LocalSocketObject>(
  name: string,
  storage: Storage = sessionStorage,
  factory: () => T,
  life: number = 0,
  meta = {
    add(name: string, life: number) { },
    delete(name: string) { }
  }
): Store<T> {
  return new Store(name, storage, factory, life, meta);
}

class Store<T extends LocalSocketObject> implements LocalStore<T> {
  constructor(
    public name: string,
    private storage: Storage,
    private factory: () => T,
    private life: number,
    private meta = {
      add(name: string, life: number) { },
      delete(name: string) { }
    }
  ) {
    this.event['toJSON'] = (): void => void 0;
  }
  private event = new Observable<LocalSocketEventType, StoreEvent, void>();
  private cache = this.storage === localStorage ? LocalStorageObjectCache : SessionStorageObjectCache;
  private eventSource = this.storage === localStorage ? events.localStorage : events.sessionStorage;
  private subscriber: (event: StorageEvent) => any = noop;
  public link(): T {
    if (this.cache.has(this.name)) return <T>this.cache.get(this.name);

    void this.close();

    const source: T = assign<T>(
      <T><any>{
        [SCHEMA.KEY.NAME]: this.name,
        [SCHEMA.EVENT.NAME]: this.event
      },
      parse<T>(this.storage.getItem(this.name) || '{}')
    );
    source.__event['toJSON'] = (): void => void 0;
    const dao: T = build(source, this.factory, (attr, newValue, oldValue) => {
      if (this.storage === localStorage && this.storage.getItem(this.name) === null) {
        void this.meta.add(this.name, this.life);
      }
      void this.storage.setItem(this.name, JSON.stringify(source));
      void this.event.emit(<any>['send', attr], new StoreEvent('send', this.name, attr, newValue, oldValue));
    });
    this.subscriber = ({newValue, oldValue}: StorageEvent): void => {
      if (newValue) {
        const item: T = parse<T>(newValue);
        void Object.keys(item)
          .filter(isValidPropertyName)
          .filter(isValidPropertyValue(item))
          .reduce((_, prop) => {
            const [newVal, oldVal] = [item[prop], source[prop]];
            if (newVal === oldVal) return;
            source[prop] = newVal;
            /*
            void document.defaultView.dispatchEvent(new StorageEvent(`storage:${this.name}`, {
              key: prop,
              oldValue: JSON.stringify(oldVal),
              newValue: JSON.stringify(newVal),
              url: location.href,
              storageArea: storage
            }));
            */
          }, void 0);
      }
      void this.event.emit(['recv'], new StoreEvent('recv', this.name, void 0, newValue, oldValue));
    };
    void this.eventSource.on(this.name, this.subscriber);
    void this.cache.add(this.name, dao);
    void this.storage.setItem(this.name, JSON.stringify(source));
    void this.meta.add(this.name, this.life);
    return dao;

    function parse<T>(item: string): T {
      try {
        return JSON.parse(item);
      }
      catch (_) {
        return <T>{};
      }
    }
  }
  public close(): void {
    void this.eventSource.off(this.name, this.subscriber);
    void this.cache.delete(this.name);
  }
  public destroy(): void {
    void this.close();
    void this.storage.removeItem(this.name);
    void this.meta.delete(this.name);
  }
}