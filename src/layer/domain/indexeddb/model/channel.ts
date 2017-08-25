import { StoreChannelObject, StoreChannelObjectMetaData } from '../../../../../';
import { Observation } from 'spica/observation';
import { Cancellation } from 'spica/cancellation';
import { Cache } from 'spica/cache';
import { open, Listen, close, destroy, idbEventStream, IDBEventType } from '../../../infrastructure/indexeddb/api';
import { DataStore } from './channel/data';
import { AccessStore } from './channel/access';
import { ExpiryStore } from './channel/expiry';
import { noop } from '../../../../lib/noop';

const cache = new Map<string, ChannelStore<string, StoreChannelObject<string>>>();

export class ChannelStore<K extends string, V extends StoreChannelObject<K>> {
  constructor(
    public readonly name: string,
    attrs: string[],
    destroy: (reason: any, event?: Event) => boolean,
    private readonly size: number,
    private readonly expiry: number,
  ) {
    if (cache.has(name)) throw new Error(`ClientChannel: Specified database channel "${name}" is already created.`);
    void cache.set(name, this);
    void this.cancellation.register(() =>
        void cache.delete(name));
    this.schema = new Schema<K, V>(this, attrs, open(name, {
      make(db) {
        return DataStore.configure().make(db)
            && AccessStore.configure().make(db)
            && ExpiryStore.configure().make(db);
      },
      verify(db) {
        return DataStore.configure().verify(db)
            && AccessStore.configure().verify(db)
            && ExpiryStore.configure().verify(db);
      },
      destroy(reason, ev) {
        return DataStore.configure().destroy(reason, ev)
            && AccessStore.configure().destroy(reason, ev)
            && ExpiryStore.configure().destroy(reason, ev)
            && destroy(reason, ev);
      },
    }));
    void this.cancellation.register(() =>
        void this.schema.close());
    void this.cancellation.register(
      idbEventStream.on([name, IDBEventType.destroy], () =>
        cache.get(name) === this &&
        void this.schema.rebuild()));
    if (size < Infinity) {
      const keys = new Cache<K>(this.size, k =>
        void this.delete(k));

      void this.events_.load.monitor([], ({ key, type }) =>
        type === ChannelStore.EventType.delete
          ? void keys.delete(key)
          : void keys.put(key));
      void this.events_.save.monitor([], ({ key, type }) =>
        type === ChannelStore.EventType.delete
          ? void keys.delete(key)
          : void keys.put(key));
      const limit = () =>
        cache.get(name) === this &&
        void this.recent(Infinity, (ks, err) => {
          if (cache.get(name) !== this) return;
          if (err) return void setTimeout(limit, 1000);
          return void ks
            .reverse()
            .forEach(k =>
              void keys.put(k));
        });
      void limit();
    }
  }
  private cancellation = new Cancellation();
  private readonly schema: Schema<K, V>;
  public readonly events_ = Object.freeze({
    load: new Observation<never[] | [K] | [K, keyof V | ''] | [K, keyof V | '', ChannelStore.EventType], ChannelStore.Event<K, V>, void>(),
    save: new Observation<never[] | [K] | [K, keyof V | ''] | [K, keyof V | '', ChannelStore.EventType], ChannelStore.Event<K, V>, void>(),
  });
  public readonly events = Object.freeze({
    load: new Observation<never[] | [K] | [K, keyof V | ''] | [K, keyof V | '', ChannelStore.EventType], ChannelStore.Event<K, V>, void>(),
    save: new Observation<never[] | [K] | [K, keyof V | ''] | [K, keyof V | '', ChannelStore.EventType], ChannelStore.Event<K, V>, void>(),
    loss: new Observation<never[] | [K] | [K, keyof V | ''] | [K, keyof V | '', ChannelStore.EventType], ChannelStore.Event<K, V>, void>()
  });
  public sync(keys: K[], cb: (errs: [K, DOMException | DOMError][]) => void = noop): void {
    return this.schema.data.sync(keys, cb);
  }
  public fetch(key: K, cb: (err?: DOMException | DOMError) => void = noop): void {
    return this.schema.data.fetch(key, cb);
  }
  public has(key: K): boolean {
    return this.schema.data.has(key);
  }
  public meta(key: K): StoreChannelObjectMetaData<K> {
    return this.schema.data.meta(key);
  }
  public get(key: K): Partial<V> {
    return this.schema.data.get(key);
  }
  public add(record: DataStore.Record<K, V>): void {
    assert(record.type === DataStore.EventType.put);
    void this.schema.access.set(record.key);
    void this.schema.expire.set(record.key, this.ages.get(record.key) || this.expiry);
    void this.schema.data.add(record);
  }
  public delete(key: K): void {
    void this.schema.data.delete(key);
    void this.schema.access.delete(key);
    void this.schema.expire.delete(key);
  }
  protected log(key: K): void {
    if (!this.has(key)) return;
    void this.schema.access.set(key);
    void this.schema.expire.set(key, this.ages.get(key) || this.expiry);
  }
  private readonly ages = new Map<K, number>();
  public expire(key: K, age: number = this.expiry): void {
    assert(age > 0);
    return void this.ages.set(key, age);
  }
  public recent(limit: number, cb: (keys: K[], err: DOMException | DOMError | null) => void): void {
    return this.schema.access.recent(limit, cb);
  }
  public close(): void {
    void this.cancellation.cancel();
    return void close(this.name);
  }
  public destroy(): void {
    void this.cancellation.cancel();
    return void destroy(this.name);
  }
}
export namespace ChannelStore {
  export import Event = DataStore.Event;
  export import EventType = DataStore.EventType;
  export import Record = DataStore.Record;
}

class Schema<K extends string, V extends StoreChannelObject<K>> {
  constructor(
    private readonly store_: ChannelStore<K, V>,
    private readonly attrs_: string[],
    private readonly listen_: Listen,
  ) {
    void this.build();
  }
  private cancellation_ = new Cancellation();
  private build(): void {
    const keys = this.data ? this.data.keys() : [];

    this.data = new DataStore<K, V>(this.attrs_, this.listen_);
    this.access = new AccessStore<K>(this.listen_);
    this.expire = new ExpiryStore<K>(this.store_, this.cancellation_, this.listen_);

    void this.cancellation_.register(this.store_.events_.load.relay(this.data.events.load));
    void this.cancellation_.register(this.store_.events_.save.relay(this.data.events.save));
    void this.cancellation_.register(this.store_.events.load.relay(this.data.events.load));
    void this.cancellation_.register(this.store_.events.save.relay(this.data.events.save));
    void this.cancellation_.register(this.store_.events.loss.relay(this.data.events.loss));

    void this.data.sync(keys);
  }
  public rebuild(): void {
    void this.close();
    void this.build();
  }
  public data: DataStore<K, V>;
  public access: AccessStore<K>;
  public expire: ExpiryStore<K>;
  public close(): void {
    void this.cancellation_.cancel();
    this.cancellation_ = new Cancellation();
  }
}
