import { BroadcastChannel, BroadcastChannelObject as ChannelObject, BroadcastChannelEvent } from '../../../../../';
import { Observable } from 'spica';
import { SCHEMA, build, isValidPropertyName, isValidPropertyValue } from '../../dao/api';
import { localStorage, sessionStorage, eventstream } from '../../../infrastructure/webstorage/api';
import { StorageLike, fakeStorage } from '../model/storage';

const cache = new Map<string, Channel<ChannelObject>>();

export class Channel<V extends ChannelObject> implements BroadcastChannel<V> {
  constructor(
    public readonly name: string,
    private readonly storage: StorageLike = sessionStorage || fakeStorage,
    private readonly factory: () => V,
    private readonly log = {
      update(_name: string) { },
      delete(_name: string) { }
    }
  ) {
    if (cache.has(name)) throw new Error(`ClientChannel: WebStorage: Specified channel ${name} is already created.`);
    void cache.set(name, this);
    const source: V = <any>{
      [SCHEMA.KEY.NAME]: this.name,
      [SCHEMA.EVENT.NAME]: new Observable<[BroadcastChannelEvent.Type] | [BroadcastChannelEvent.Type, keyof V], Channel.Event<V>, void>(),
      ...<Object>parse<V>(this.storage.getItem(this.name))
    };
    this.link_ = build(source, this.factory, (attr: keyof V, newValue, oldValue) => {
      void this.log.update(this.name);
      void this.storage.setItem(this.name, JSON.stringify(Object.keys(source).filter(isValidPropertyName).filter(isValidPropertyValue(source)).reduce((acc, attr) => {
        acc[attr] = source[attr];
        return acc;
      }, {})));
      const event = new Channel.Event<V>(Channel.Event.Type.send, attr, newValue, oldValue);
      void (<Observable<[BroadcastChannelEvent.Type, keyof V], Channel.Event<V>, any>>source.__event).emit([event.type, event.attr], event);
      void this.events.send.emit([event.attr], event);
    });
    const subscriber = ({newValue}: StorageEvent): void => {
      const item: V = parse<V>(newValue);
      void Object.keys(item)
        .filter(isValidPropertyName)
        .filter(isValidPropertyValue(item))
        .reduce<void>((_, attr: keyof V) => {
          const oldVal = source[attr];
          const newVal = item[attr];
          if (newVal === oldVal) return;
          source[attr] = newVal;
          const event = new Channel.Event<V>(Channel.Event.Type.recv, attr, newVal, oldVal);
          void (<Observable<[BroadcastChannelEvent.Type, keyof V], Channel.Event<V>, any>>source.__event).emit([event.type, event.attr], event);
          void this.events.recv.emit([event.attr], event);
        }, void 0);
    };
    void eventstream.on([this.mode, this.name], subscriber);
    void this.log.update(this.name);
    void Object.freeze(this);
  }
  private readonly mode = this.storage === localStorage ? 'local' : 'session';
  public readonly events = {
    send: new Observable<never[] | [keyof V], Channel.Event<V>, void>(),
    recv: new Observable<never[] | [keyof V], Channel.Event<V>, void>()
  };
  private readonly link_: V;
  public link(): V {
    return this.link_;
  }
  public destroy(): void {
    void eventstream.off([this.mode, this.name]);
    void this.storage.removeItem(this.name);
    void this.log.delete(this.name);
    void cache.delete(this.name);
  }
}
export namespace Channel {
  export class Event<V extends ChannelObject> implements BroadcastChannelEvent<V> {
    constructor(
      public readonly type: Event.Type,
      public readonly attr: keyof V,
      public readonly newValue: any,
      public readonly oldValue: any
    ) {
      assert(typeof type === 'string');
      assert(typeof attr === 'string');
      void Object.freeze(this);
    }
  }
  export namespace Event {
    export type Type = BroadcastChannelEvent.Type;
    export namespace Type {
      export const send: BroadcastChannelEvent.Type.Send = 'send';
      export const recv: BroadcastChannelEvent.Type.Recv = 'recv';
    }
  }
}

function parse<V>(item: string | undefined | null): V {
  try {
    return JSON.parse(item || '{}') || <V>{};
  }
  catch (_) {
    return <V>{};
  }
}
