import { StoreChannelObject, StoreChannelConfig } from '../../../';
import { StorageChannelObject, StorageChannelConfig } from '../../../';
import { StoreChannel as BaseStoreChannel } from '../domain/indexeddb/api';
import { StorageChannel as BaseStorageChannel, localStorage } from '../domain/webstorage/api';
import { Channel as BroadcastChannel } from '../domain/broadcast/channel';
import { Ownership as BaseOwnership } from '../domain/ownership/channel';

export * from '../domain/indexeddb/api';
export * from '../domain/webstorage/api';

export class StoreChannel<K extends string, V extends StoreChannelObject<K>> extends BaseStoreChannel<K, V> {
  constructor(
    name: string,
    config: StoreChannelConfig<K, V>,
  ) {
    super(name, config.Schema, config);
  }
}

export class StorageChannel<V extends StorageChannelObject> extends BaseStorageChannel<V> {
  constructor(
    name: string,
    {
      Schema,
      migrate = () => undefined,
    }: StorageChannelConfig<V>
  ) {
    super(name, localStorage, Schema, migrate);
  }
}

export class Ownership<K extends string> extends BaseOwnership<K> {
  constructor(name: K) {
    super(new BroadcastChannel(name, false));
  }
}
