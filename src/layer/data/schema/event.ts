import { StoreChannelEvent } from '../../../../';
import { clone } from 'spica';
import { IdNumber } from '../constraint/types';

export namespace EventRecordFields {
  export const id: 'id' = 'id';
  export const key: 'key' = 'key';
  export const type: 'type' = 'type';
  export const attr: 'attr' = 'attr';
  export const value: 'value' = 'value';
  export const date: 'date' = 'date';
  export const surrogateKeyDateField: 'key+date' = 'key+date';
}

abstract class EventRecord<K extends string, V extends EventValue> {
  constructor(
    key: K,
    value: V,
    date: number,
    type: EventType
  ) {
    if (typeof this.id === 'number' && <number>this.id > 0 === false || this.id !== void 0) throw new TypeError(`ClientChannel: EventRecord: Invalid event id: ${this.id}`);
    this.type = type;
    if (typeof this.type !== 'string') throw new TypeError(`ClientChannel: EventRecord: Invalid event type: ${this.type}`);
    this.key = key;
    if (typeof this.key !== 'string') throw new TypeError(`ClientChannel: EventRecord: Invalid event key: ${this.key}`);
    this.value = value;
    if (typeof this.value !== 'object' || !this.value) throw new TypeError(`ClientChannel: EventRecord: Invalid event value: ${this.value}`);
    this.date = date;
    if (typeof this.date !== 'number' || this.date >= 0 === false) throw new TypeError(`ClientChannel: EventRecord: Invalid event date: ${this.date}`);
    // put -> string, delete or snapshot -> empty string
    this.attr = this.type === EventType.put
      ? Object.keys(value).reduce((r, p) => p.length > 0 && p[0] !== '_' && p[p.length - 1] !== '_' ? p : r, '')
      : '';
    if (typeof this.attr !== 'string') throw new TypeError(`ClientChannel: EventRecord: Invalid event attr: ${this.key}`);
    if (this.type === EventType.put && this.attr.length === 0) throw new TypeError(`ClientChannel: EventRecord: Invalid event attr with ${this.type}: ${this.attr}`);
    if (this.type !== EventType.put && this.attr.length !== 0) throw new TypeError(`ClientChannel: EventRecord: Invalid event attr with ${this.type}: ${this.attr}`);

    switch (type) {
      case EventType.put: {
        this.value = value = <V>clone(new EventValue(), <EventValue>{ [this.attr]: value[this.attr] });
        void Object.freeze(this.value);
        return;
      }
      case EventType.snapshot: {
        this.value = value = <V>clone(new EventValue(), value);
        void Object.freeze(this.value);
        return;
      }
      case EventType.delete: {
        this.value = value = <V>new EventValue();
        void Object.freeze(this.value);
        return;
      }
      default:
        throw new TypeError(`ClientChannel: Invalid event type: ${type}`);
    }
  }
  public readonly id: IdNumber | never;
  public readonly type: EventType;
  public readonly key: K;
  public readonly attr: string;
  public readonly value: V;
  public readonly date: number;
}
export class UnsavedEventRecord<K extends string, V extends EventValue> extends EventRecord<K, V> {
  private EVENT_RECORD: V;
  constructor(
    key: K,
    value: V,
    type: EventType = EventType.put,
    date: number = Date.now()
  ) {
    super(key, value, date, type);
    this.EVENT_RECORD;
    // must not have id property
    if (this.id !== void 0 || 'id' in this) throw new TypeError(`ClientChannel: UnsavedEventRecord: Invalid event id: ${this.id}`);
    void Object.freeze(this);
  }
  public readonly id: never;
}
export class SavedEventRecord<K extends string, V extends EventValue> extends EventRecord<K, V> {
  private EVENT_RECORD: V;
  constructor(
    public readonly id: IdNumber,
    key: K,
    value: V,
    type: EventType,
    date: number
  ) {
    super(key, value, date, type);
    this.EVENT_RECORD;
    if (<number>this.id > 0 === false) throw new TypeError(`ClientChannel: SavedEventRecord: Invalid event id: ${this.id}`);
    void Object.freeze(this);
  }
}

export const EventType = {
  put: <EventType.Put>'put',
  delete: <EventType.Delete>'delete',
  snapshot: <EventType.Snapshot>'snapshot'
};
export type EventType = StoreChannelEvent.Type
export namespace EventType {
  export type Put = StoreChannelEvent.Type.Put;
  export type Delete = StoreChannelEvent.Type.Delete;
  export type Snapshot = StoreChannelEvent.Type.Snapshot;
}

export class EventValue {
}
