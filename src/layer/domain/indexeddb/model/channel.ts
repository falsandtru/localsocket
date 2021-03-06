import { Infinity, Promise, setTimeout } from 'spica/global';
import { StoreChannelObject, StoreChannelObjectMetaData } from '../../../../../';
import { Observation } from 'spica/observer';
import { Cancellation } from 'spica/cancellation';
import { AtomicPromise, PromiseSettledResult } from 'spica/promise';
import { Cache } from 'spica/cache';
import { open, Listen, close, destroy, idbEventStream, IDBEventType } from '../../../infrastructure/indexeddb/api';
import { DataStore } from './channel/data';
import { AccessStore } from './channel/access';
import { ExpiryStore } from './channel/expiry';
import { Channel, ChannelMessage } from '../../broadcast/channel';
import { Ownership } from '../../ownership/channel';

declare global {
  interface ChannelMessageTypeMap<K extends string> {
    save: SaveMessage<K>;
  }
}

class SaveMessage<K extends string> extends ChannelMessage<K> {
  constructor(
    public override readonly key: K,
  ) {
    super(key, 'save');
  }
}

const cache = new Set<string>();

export class ChannelStore<K extends string, V extends StoreChannelObject<K>> {
  constructor(
    public readonly name: string,
    attrs: string[],
    destroy: (reason: unknown, event?: Event) => boolean,
    private readonly age: number,
    private readonly capacity: number,
    private readonly debug = false,
  ) {
    if (cache.has(name)) throw new Error(`ClientChannel: Store channel "${name}" is already open.`);
    void cache.add(name);
    void this.cancellation.register(() =>
      void cache.delete(name));

    this.schema = new Schema<K, V>(this, this.ownership, attrs, open(name, {
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
    void this.cancellation.register(idbEventStream.on([name, IDBEventType.destroy], () =>
      void this.schema.rebuild()));
    void this.cancellation.register(() =>
      void this.schema.close());

    void this.cancellation.register(() =>
      void this.ownership.close());

    void this.cancellation.register(() =>
      void this.channel.close());
    void this.cancellation.register(this.channel.listen('save', ({ key }) =>
      void this.fetch(key)));

    void this.events_.save.monitor([], ({ key }) =>
      void this.channel.post(new SaveMessage(key)));

    void this.events_.clear.monitor([], (_, [key]) => {
      if (key === void 0) return;
      assert(this.meta(key).date === 0);
      void this.ownership.take(`key:${key}`, 10 * 1000);
      void this.schema.access.delete(key);
      void this.schema.expire.delete(key);
    });

    if (this.capacity === Infinity) return;

    void this.events_.load.monitor([], ({ key, type }) =>
      type === ChannelStore.EventType.delete
        ? void this.keys_.delete(key) || void this.keys.delete(key)
        : void this.keys_.delete(key) || void this.keys.put(key));
    void this.events_.save.monitor([], ({ key, type }) =>
      type === ChannelStore.EventType.delete
        ? void this.keys_.delete(key) || void this.keys.delete(key)
        : void this.keys_.delete(key) || void this.keys.put(key));
  }
  private readonly cancellation = new Cancellation();
  private readonly schema: Schema<K, V>;
  private readonly channel = new Channel<K>(this.name, this.debug);
  private readonly ownership = new Ownership<string>(this.channel);
  private readonly keys_ = new Set<K>();
  private readonly keys = new Cache<K>(this.capacity, {
    disposer: (() => {
      const queue = this.keys_;
      let timer = 0;
      const schedule = (): void => {
        if (!this.alive) return;
        if (timer === 0) return;
        timer = 0;
        if (!this.ownership.take('store', 10 * 1000)) return;
        for (const key of queue) {
          if (!this.alive) return void this.keys.clear(), void queue.clear();
          if (!this.ownership.extend('store', 10 * 1000)) return timer = setTimeout(schedule, 10 * 1000) as any;
          if (!this.ownership.take(`key:${key}`, 10 * 1000)) return timer = setTimeout(schedule, 10 * 1000) as any;
          void queue.delete(key);
          this.has(key)
            ? void this.delete(key)
            : void this.clean(key);
          assert(!this.has(key));
        }
      };
      return (_: void, key: K): void => {
        void queue.add(key);
        if (timer > 0) return;
        timer = setTimeout(schedule, 3 * 1000) as any;
      };
    })(),
    capture: { delete: false },
  });
  protected get alive(): boolean {
    return this.cancellation.alive;
  }
  public readonly events_ = {
    load: new Observation<[K, Extract<keyof V | '', string>, ChannelStore.EventType], ChannelStore.Event<K, V>, void>(),
    save: new Observation<[K, Extract<keyof V | '', string>, ChannelStore.EventType], ChannelStore.Event<K, V>, void>(),
    clear: new Observation<[K], undefined, void>(),
  } as const;
  public readonly events = {
    load: new Observation<[K, Extract<keyof V | '', string>, ChannelStore.EventType], ChannelStore.Event<K, V>, void>({ limit: Infinity }),
    save: new Observation<[K, Extract<keyof V | '', string>, ChannelStore.EventType], ChannelStore.Event<K, V>, void>({ limit: Infinity }),
    loss: new Observation<[K, Extract<keyof V | '', string>, ChannelStore.EventType], ChannelStore.Event<K, V>, void>({ limit: Infinity }),
  } as const;
  protected ensureAliveness(): void {
    if (!this.alive) throw new Error(`ClientChannel: Store channel "${this.name}" is already closed.`);
  }
  public sync(keys: readonly K[], timeout?: number): Promise<PromiseSettledResult<K>[]> {
    void this.ensureAliveness();
    const cancellation = timeout === void 0
      ? void 0
      : new Cancellation();
    cancellation && void setTimeout(cancellation.cancel, timeout);
    return Promise.resolve(AtomicPromise.allSettled(
      keys.map(key =>
        new Promise<K>((resolve, reject) =>
          void this.fetch(key, error =>
            error
              ? void reject(error)
              : void resolve(key),
            cancellation)))));
  }
  public fetch(key: K, cb?: (error: DOMException | Error | null) => void, cancellation?: Cancellation): void {
    void this.ensureAliveness();
    void this.schema.access.fetch(key);
    return this.schema.data.fetch(key, cb, cancellation);
  }
  public has(key: K): boolean {
    void this.ensureAliveness();
    return this.schema.data.has(key);
  }
  public meta(key: K): StoreChannelObjectMetaData<K> {
    void this.ensureAliveness();
    return this.schema.data.meta(key);
  }
  public get(key: K): Partial<V> {
    void this.ensureAliveness();
    void this.log(key);
    return this.schema.data.get(key);
  }
  public add(record: DataStore.Record<K, V>): void {
    assert(record.type === DataStore.EventType.put);
    void this.ensureAliveness();
    const key = record.key;
    void this.schema.data.add(record);
    void this.log(key);
  }
  public delete(key: K): void {
    void this.ensureAliveness();
    void this.ownership.take(`key:${key}`, 10 * 1000);
    void this.schema.data.delete(key);
    void this.events.save.once([key, '', ChannelStore.EventType.delete], () =>
      void this.ownership.take(`key:${key}`, 10 * 1000));
  }
  public clean(key: K): void {
    void this.ensureAliveness();
    void this.ownership.take(`key:${key}`, 10 * 1000);
    void this.schema.data.clean(key);
  }
  protected log(key: K): void {
    if (!this.has(key)) return;
    void this.schema.access.set(key);
    void this.schema.expire.set(key, this.ages.get(key) ?? this.age);
  }
  private readonly ages = new Map<K, number>();
  public expire(key: K, age: number = this.age): void {
    assert(age > 0);
    void this.ensureAliveness();
    void this.ages.set(key, age);
  }
  public recent(timeout?: number): Promise<K[]>;
  public recent(cb?: (key: K, keys: readonly K[]) => boolean | void, timeout?: number): Promise<K[]>;
  public recent(cb?: number | ((key: K, keys: readonly K[]) => boolean | void), timeout?: number): Promise<K[]> {
    if (typeof cb === 'number') return this.recent(void 0, cb);
    void this.ensureAliveness();
    return this.schema.access.recent(cb, timeout);
  }
  public close(): void {
    void this.cancellation.cancel();
    return void close(this.name);
  }
  public destroy(): void {
    void this.ensureAliveness();
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
    private readonly store: ChannelStore<K, V>,
    private readonly ownership: Ownership<string>,
    private readonly attrs: string[],
    private readonly listen: Listen,
  ) {
    void this.build();
  }
  private cancellation = new Cancellation();
  private build(): void {
    assert(this.cancellation.alive);
    const keys = this.data ? this.data.keys() : [];

    this.data = new DataStore<K, V>(this.attrs, this.listen);
    this.access = new AccessStore<K>(this.listen);
    this.expire = new ExpiryStore<K>(this.store, this.cancellation, this.ownership, this.listen);

    void this.cancellation.register(() => this.data.close());
    void this.cancellation.register(() => this.access.close());
    void this.cancellation.register(() => this.expire.close());

    void this.cancellation.register(this.store.events_.load.relay(this.data.events.load));
    void this.cancellation.register(this.store.events_.save.relay(this.data.events.save));
    void this.cancellation.register(this.store.events_.clear.relay(this.data.events.clear));
    void this.cancellation.register(this.store.events.load.relay(this.data.events.load));
    void this.cancellation.register(this.store.events.save.relay(this.data.events.save));
    void this.cancellation.register(this.store.events.loss.relay(this.data.events.loss));

    void this.store.sync(keys);
  }
  public rebuild(): void {
    void this.close();
    this.cancellation = new Cancellation();
    void this.build();
  }
  public data!: DataStore<K, V>;
  public access!: AccessStore<K>;
  public expire!: ExpiryStore<K>;
  public close(): void {
    void this.cancellation.cancel();
  }
}
