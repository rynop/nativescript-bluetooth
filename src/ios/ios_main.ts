declare var NSMakeRange;

import { ios as iOS_Utils } from 'tns-core-modules/utils/utils';
import { BluetoothCommon, BluetoothUtil, CLog, CLogTypes, ConnectOptions, StartNotifyingOptions, StartScanningOptions, StopNotifyingOptions, WriteOptions } from '../common';
import { CBPeripheralDelegateImpl } from './CBPeripheralDelegateImpl';
import { CBCentralManagerDelegateImpl } from './CBCentralManagerDelegateImpl';

export function toArrayBuffer(value) {
    if (value === null) {
        return null;
    }

    // value is of ObjC type: NSData
    // const b = value.base64EncodedStringWithOptions(0);
    // return this.base64ToArrayBuffer(b);
    return interop.bufferFromData(value);
}

export function CBUUIDToString(uuid: CBUUID) {
    return uuid.toString().toLowerCase();
}

export class Bluetooth extends BluetoothCommon {
    private _centralDelegate = CBCentralManagerDelegateImpl.new().initWithCallback(new WeakRef(this), obj => {
        CLog(CLogTypes.info, `---- centralDelegate ---- obj: ${obj}`);
    });
    private _centralManager: CBCentralManager;

    private _data_service: CBMutableService;
    public _discoverPeripherals: { [k: string]: CBPeripheral } = {};
    public _connectedPeripherals: { [k: string]: CBPeripheral } = {};
    public _connectCallbacks = {};
    public _advData = {};
    public _disconnectCallbacks = {};
    public _onDiscovered = null;

    constructor(restoreIdentifier?: string) {
        super();
        let options: NSDictionary<any, any> = null;
        if (restoreIdentifier) {
            options = new (NSDictionary as any)([restoreIdentifier], [CBCentralManagerOptionRestoreIdentifierKey]);
        }
        this._centralManager = CBCentralManager.alloc().initWithDelegateQueueOptions(this._centralDelegate, null, options);
        CLog(CLogTypes.info, '*** iOS Bluetooth Constructor *** ${restoreIdentifier}');
        CLog(CLogTypes.info, `this._centralManager: ${this._centralManager}`);
    }

    // Getters/Setters
    get enabled(): boolean {
        const state = this._centralManager.state;
        if (state === CBManagerState.PoweredOn) {
            return true;
        } else {
            return false;
        }
    }

    public _getState(state: CBPeripheralState) {
        if (state === CBPeripheralState.Connecting) {
            return 'connecting';
        } else if (state === CBPeripheralState.Connected) {
            return 'connected';
        } else if (state === CBPeripheralState.Disconnected) {
            return 'disconnected';
        } else {
            CLog(CLogTypes.warning, '_getState ---- Unexpected state, returning "disconnected" for state of', state);
            return 'disconnected';
        }
    }

    public onPeripheralDisconnected(peripheral: CBPeripheral) {
        const UUID = peripheral.identifier.UUIDString;
        delete this._connectedPeripherals[UUID];
    }
    public onPeripheralConnected(peripheral: CBPeripheral) {
        const UUID = peripheral.identifier.UUIDString;
        this._connectedPeripherals[UUID] = peripheral;
    }

    public isBluetoothEnabled() {
        return new Promise((resolve, reject) => {
            try {
                const isEnabled = this._isEnabled();
                resolve(isEnabled);
            } catch (ex) {
                CLog(CLogTypes.error, 'isBluetoothEnabled ----', ex);
                reject(ex);
            }
        });
    }
    scanningReferTimer: {
        timer?: number;
        resolve?: Function;
    };
    public startScanning(arg: StartScanningOptions) {
        return new Promise((resolve, reject) => {
            try {
                if (!this._isEnabled()) {
                    CLog(CLogTypes.info, 'startScanning ---- Bluetooth is not enabled.');
                    reject('Bluetooth is not enabled.');
                    return;
                }
                this._discoverPeripherals = {};
                this._onDiscovered = arg.onDiscovered;

                let services: any[] = null;
                if (arg.filters) {
                    services = [];
                    arg.filters.forEach(f => {
                        if (f.serviceUUID) {
                            services.push(CBUUID.UUIDWithString(f.serviceUUID));
                        }
                    });
                }
                CLog(CLogTypes.info, 'startScanning ---- services:', services);

                // TODO: check on the services as any casting
                this._centralManager.scanForPeripheralsWithServicesOptions(services as any, null);
                if (this.scanningReferTimer) {
                    clearTimeout(this.scanningReferTimer.timer);
                    this.scanningReferTimer.resolve();
                }
                this.scanningReferTimer = {};
                if (arg.seconds) {
                    this.scanningReferTimer.timer = setTimeout(() => {
                        // note that by now a manual 'stop' may have been invoked, but that doesn't hurt
                        this._centralManager.stopScan();
                        resolve();
                    }, arg.seconds * 1000);
                    this.scanningReferTimer.resolve = resolve;
                } else {
                    resolve();
                }
            } catch (ex) {
                CLog(CLogTypes.error, 'startScanning ---- error:', ex);
                reject(ex);
            }
        });
    }

    public enable() {
        return new Promise((resolve, reject) => {
            CLog(CLogTypes.info, 'enable ---- Not possible on iOS');
            resolve(this._isEnabled());
        });
    }
    public isGPSEnabled() {
        return Promise.resolve(true); // we dont need to check for GPS in the bluetooth iOS module
    }
    public enableGPS(): Promise<void> {
        return Promise.resolve(); // we dont need to check for GPS in the bluetooth iOS module
    }

    public openBluetoothSettings(url?: string): Promise<void> {
        console.log('openBluetoothSettings', this._isEnabled());
        if (!this._isEnabled()) {
            return Promise.resolve().then(() => {
                const settingsUrl = NSURL.URLWithString(url || 'App-prefs:root=General&path=BLUETOOTH');
                console.log('openBluetoothSettings url ', settingsUrl.absoluteString, UIApplication.sharedApplication.canOpenURL(settingsUrl));
                if (UIApplication.sharedApplication.canOpenURL(settingsUrl)) {
                    UIApplication.sharedApplication.openURLOptionsCompletionHandler(settingsUrl, null, function(success) {
                        // we get the callback for opening the URL, not enabling the GPS!
                        if (success) {
                            // if (isEnabled()) {
                            //     return Promise.resolve();
                            // } else {
                            return Promise.reject(undefined);
                            // }
                        } else {
                            return Promise.reject('cant_open_settings');
                        }
                    });
                }
            });
        }
        return Promise.resolve();
    }
    public stopScanning(arg) {
        return new Promise((resolve, reject) => {
            try {
                if (!this._isEnabled()) {
                    reject('Bluetooth is not enabled.');
                    return;
                }
                this._centralManager.stopScan();
                if (this.scanningReferTimer) {
                    this.scanningReferTimer.resolve && this.scanningReferTimer.resolve();
                    clearTimeout(this.scanningReferTimer.timer);
                    this.scanningReferTimer = null;
                }
                resolve();
            } catch (ex) {
                CLog(CLogTypes.error, 'stopScanning ---- error:', ex);
                reject(ex);
            }
        });
    }

    // note that this doesn't make much sense without scanning first
    public connect(args: ConnectOptions) {
        return new Promise((resolve, reject) => {
            try {
                if (!this._isEnabled()) {
                    reject('Bluetooth is not enabled.');
                    return;
                }
                if (!args.UUID) {
                    reject('No UUID was passed');
                    return;
                }
                // console.log('test', this._discoverPeripherals);
                CLog(CLogTypes.info, 'connect ----', args.UUID);
                const peripheral = this.findDiscoverPeripheral(args.UUID);

                CLog(CLogTypes.info, 'connect ---- peripheral found', peripheral);

                if (!peripheral) {
                    reject(`Could not find peripheral with UUID: ${args.UUID}`);
                } else {
                    CLog(CLogTypes.info, 'connect ---- Connecting to peripheral with UUID:', args.UUID);
                    this._connectCallbacks[args.UUID] = args.onConnected;
                    this._disconnectCallbacks[args.UUID] = args.onDisconnected;
                    this._centralManager.connectPeripheralOptions(peripheral, null);
                    resolve();
                }
            } catch (ex) {
                CLog(CLogTypes.error, 'connect ---- error:', ex);
                reject(ex);
            }
        });
    }

    public disconnect(arg) {
        return new Promise((resolve, reject) => {
            try {
                if (!this._isEnabled()) {
                    reject('Bluetooth is not enabled');
                    return;
                }
                if (!arg.UUID) {
                    reject('No UUID was passed');
                    return;
                }
                const peripheral = this.findPeripheral(arg.UUID);
                if (!peripheral) {
                    reject('Could not find peripheral with UUID ' + arg.UUID);
                } else {
                    CLog(CLogTypes.info, 'disconnect ---- Disconnecting peripheral with UUID', arg.UUID);
                    // no need to send an error when already disconnected, but it's wise to check it
                    if (peripheral.state !== CBPeripheralState.Disconnected) {
                        this._centralManager.cancelPeripheralConnection(peripheral);
                        // peripheral.delegate = null;
                        // TODO remove from the peripheralArray as well
                    }
                    resolve();
                }
            } catch (ex) {
                CLog(CLogTypes.error, 'disconnect ---- error:', ex);
                reject(ex);
            }
        });
    }

    public isConnected(arg) {
        return new Promise((resolve, reject) => {
            try {
                if (!this._isEnabled()) {
                    reject('Bluetooth is not enabled');
                    return;
                }
                if (!arg.UUID) {
                    reject('No UUID was passed');
                    return;
                }
                const peripheral = this.findPeripheral(arg.UUID);
                if (peripheral === null) {
                    reject('Could not find peripheral with UUID ' + arg.UUID);
                } else {
                    CLog(CLogTypes.info, 'isConnected ---- checking connection with peripheral UUID:', arg.UUID);
                    resolve(peripheral.state === CBPeripheralState.Connected);
                }
            } catch (ex) {
                CLog(CLogTypes.error, 'isConnected ---- error:', ex);
                reject(ex);
            }
        });
    }

    public findPeripheral = UUID => {
        let result = this._connectedPeripherals[UUID] || this._discoverPeripherals[UUID];
        if (!result) {
            const periphs = this._centralManager.retrievePeripheralsWithIdentifiers([NSUUID.alloc().initWithUUIDString(UUID)]);
            if (periphs.count > 0) {
                result = periphs.objectAtIndex(0);
            }
        }
        return result;
    }
    public adddDiscoverPeripheral = peripheral => {
        const UUID = peripheral.identifier.UUIDString;
        if (!this._discoverPeripherals[UUID]) {
            this._discoverPeripherals[UUID] = peripheral;
        }
    }
    public findDiscoverPeripheral = UUID => {
        let result = this._discoverPeripherals[UUID];
        if (!result) {
            const periphs = this._centralManager.retrievePeripheralsWithIdentifiers([NSUUID.alloc().initWithUUIDString(UUID)]);
            if (periphs.count > 0) {
                result = periphs.objectAtIndex(0);
            }
        }
        return result;
    }

    public read(arg) {
        return new Promise((resolve, reject) => {
            try {
                const wrapper = this._getWrapper(arg, CBCharacteristicProperties.PropertyRead, reject);
                if (!wrapper) {
                    // no need to reject, this has already been done in _getWrapper()
                    return;
                }

                // TODO we could (should?) make this characteristic-specific
                (wrapper.peripheral.delegate as CBPeripheralDelegateImpl)._onReadPromise = resolve;
                wrapper.peripheral.readValueForCharacteristic(wrapper.characteristic);
            } catch (ex) {
                CLog(CLogTypes.error, 'read ---- error:', ex);
                reject(ex);
            }
        });
    }

    public write(arg: WriteOptions) {
        return new Promise((resolve, reject) => {
            try {
                if (!arg.value) {
                    reject(`You need to provide some data to write in the 'value' property.`);
                    return;
                }
                const wrapper = this._getWrapper(arg, CBCharacteristicProperties.PropertyWrite, reject);
                if (!wrapper) {
                    // no need to reject, this has already been done
                    return;
                }

                const valueEncoded = this.valueToNSData(arg.value, arg.encoding);
                if (BluetoothUtil.debug) {
                    CLog(CLogTypes.info, 'write:', arg.value);
                }
                if (valueEncoded === null) {
                    reject('Invalid value: ' + arg.value);
                    return;
                }

                // the promise will be resolved from 'didWriteValueForCharacteristic',
                // but we should make this characteristic-specific (see .read)
                (wrapper.peripheral.delegate as CBPeripheralDelegateImpl)._onWritePromise = resolve;

                wrapper.peripheral.writeValueForCharacteristicType(
                    valueEncoded,
                    wrapper.characteristic,
                    // CBCharacteristicWriteWithResponse
                    CBCharacteristicWriteType.WithResponse
                );

                if (BluetoothUtil.debug) {
                    CLog(CLogTypes.info, 'write:', arg.value, JSON.stringify(this.valueToString(valueEncoded)));
                }
            } catch (ex) {
                CLog(CLogTypes.error, 'write ---- error:', ex);
                reject(ex);
            }
        });
    }

    public writeWithoutResponse(arg: WriteOptions) {
        return new Promise((resolve, reject) => {
            try {
                if (!arg.value) {
                    reject("You need to provide some data to write in the 'value' property");
                    return;
                }
                const wrapper = this._getWrapper(arg, CBCharacteristicProperties.PropertyWriteWithoutResponse, reject);
                if (!wrapper) {
                    // no need to reject, this has already been done
                    return;
                }

                const valueEncoded = this.valueToNSData(arg.value, arg.encoding);

                if (valueEncoded === null) {
                    reject('Invalid value: ' + arg.value);
                    return;
                }

                wrapper.peripheral.writeValueForCharacteristicType(valueEncoded, wrapper.characteristic, CBCharacteristicWriteType.WithoutResponse);

                if (BluetoothUtil.debug) {
                    CLog(CLogTypes.info, 'writeWithoutResponse:', arg.value, JSON.stringify(this.valueToString(valueEncoded)));
                }

                resolve();
            } catch (ex) {
                CLog(CLogTypes.error, 'writeWithoutResponse ---- error:', ex);
                reject(ex);
            }
        });
    }

    public startNotifying(args: StartNotifyingOptions) {
        return new Promise((resolve, reject) => {
            try {
                const wrapper = this._getWrapper(args, CBCharacteristicProperties.PropertyNotify, reject);
                CLog(CLogTypes.info, 'startNotifying ---- wrapper:', wrapper);

                if (!wrapper) {
                    // no need to reject, this has already been done in _getWrapper
                    return;
                }

                const cb =
                    args.onNotify ||
                    function(result) {
                        CLog(CLogTypes.info, 'startNotifying ---- No "onNotify" callback function specified for "startNotifying()"');
                    };

                // TODO we could (should?) make this characteristic-specific
                (wrapper.peripheral.delegate as CBPeripheralDelegateImpl)._onNotifyCallback = cb;
                wrapper.peripheral.setNotifyValueForCharacteristic(true, wrapper.characteristic);
                resolve();
            } catch (ex) {
                CLog(CLogTypes.error, 'startNotifying ---- error:', ex);
                reject(ex);
            }
        });
    }

    public stopNotifying(args: StopNotifyingOptions) {
        return new Promise((resolve, reject) => {
            try {
                const wrapper = this._getWrapper(args, CBCharacteristicProperties.PropertyNotify, reject);
                CLog(CLogTypes.info, 'stopNotifying ---- wrapper:', wrapper);

                if (wrapper === null) {
                    // no need to reject, this has already been done
                    return;
                }

                const peripheral = this.findPeripheral(args.peripheralUUID);
                // peripheral.delegate = null;
                peripheral.setNotifyValueForCharacteristic(false, wrapper.characteristic);
                resolve();
            } catch (ex) {
                CLog(CLogTypes.error, 'stopNotifying ---- error:', ex);
                reject(ex);
            }
        });
    }

    private _isEnabled() {
        const state = this._centralManager.state;
        // CLog(CLogTypes.info, '_isEnabled ---- this._centralManager.state:', this._centralManager.state);
        return state === CBManagerState.PoweredOn;
    }

    private _stringToUuid(uuidStr) {
        if (uuidStr.length === 4) {
            uuidStr = `0000${uuidStr}-0000-1000-8000-00805f9b34fb`;
        }
        return CFUUIDCreateFromString(null, uuidStr);
    }

    private _findService(UUID: CBUUID, peripheral: CBPeripheral) {
        for (let i = 0; i < peripheral.services.count; i++) {
            const service = peripheral.services.objectAtIndex(i);
            // CLog("--- service.UUID: " + service.UUID);
            // TODO this may need a different compare, see Cordova plugin's findServiceFromUUID function
            if (UUID.isEqual(service.UUID)) {
                // CLog(CLogTypes.info, '_findService ---- found service with UUID:', service.UUID);
                return service;
            }
        }
        // service not found on this peripheral
        return null;
    }

    private _findCharacteristic(UUID: CBUUID, service: CBService, property?: CBCharacteristicProperties) {
        // CLog(CLogTypes.info, `_findCharacteristic ---- UUID: ${UUID}, service: ${service}, characteristics: ${service.characteristics}`);
        // CLog("--- _findCharacteristic characteristics.count: " + service.characteristics.count);
        for (let i = 0; i < service.characteristics.count; i++) {
            const characteristic = service.characteristics.objectAtIndex(i);
            // CLog("--- characteristic.UUID: " + characteristic.UUID);
            if (UUID.isEqual(characteristic.UUID)) {
                // if (property) {
                //   if ((characteristic.properties & property) === property) {
                if (property && characteristic.properties) {
                    if (property === property) {
                        // CLog(CLogTypes.info, '_findCharacteristic ---- characteristic.found:', characteristic.UUID);
                        return characteristic;
                    }
                } else {
                    return characteristic;
                }
            }
        }
        // characteristic not found on this service
        // CLog(CLogTypes.warning, '_findCharacteristic ---- characteristic NOT found');
        return null;
    }

    private _getWrapper(
        arg,
        property: CBCharacteristicProperties,
        reject
    ): {
        peripheral: CBPeripheral;
        service: CBService;
        characteristic: CBCharacteristic;
    } {
        if (!this._isEnabled()) {
            reject('Bluetooth is not enabled');
            return null;
        }
        if (!arg.peripheralUUID) {
            reject('No peripheralUUID was passed');
            return null;
        }
        if (!arg.serviceUUID) {
            reject('No serviceUUID was passed');
            return null;
        }
        if (!arg.characteristicUUID) {
            reject('No characteristicUUID was passed');
            return null;
        }

        const peripheral = this.findPeripheral(arg.peripheralUUID);
        if (!peripheral) {
            reject('Could not find peripheral with UUID ' + arg.peripheralUUID);
            return null;
        }

        if (peripheral.state !== CBPeripheralState.Connected) {
            reject('The peripheral is disconnected');
            return null;
        }

        const serviceUUID = CBUUID.UUIDWithString(arg.serviceUUID);
        const service = this._findService(serviceUUID, peripheral);
        if (!service) {
            reject(`Could not find service with UUID ${arg.serviceUUID} on peripheral with UUID ${arg.peripheralUUID}`);
            return null;
        }

        const characteristicUUID = CBUUID.UUIDWithString(arg.characteristicUUID);
        let characteristic = this._findCharacteristic(characteristicUUID, service, property);

        // Special handling for INDICATE. If charateristic with notify is not found, check for indicate.
        // if (property === CBCharacteristicPropertyNotify && !characteristic) {
        if (property === CBCharacteristicProperties.PropertyNotify && !characteristic) {
            characteristic = this._findCharacteristic(characteristicUUID, service, CBCharacteristicProperties.PropertyIndicate);
            // characteristic = this._findCharacteristic(characteristicUUID, service, CBCharacteristicProperties.PropertyIndicate PropertyIndicate);
        }

        // As a last resort, try and find ANY characteristic with this UUID, even if it doesn't have the correct properties
        if (!characteristic) {
            characteristic = this._findCharacteristic(characteristicUUID, service, null);
        }

        if (!characteristic) {
            reject(`Could not find characteristic with UUID ${arg.characteristicUUID} on service with UUID ${arg.serviceUUID} on peripheral with UUID ${arg.peripheralUUID}`);
            return null;
        }

        // with that all being checked, let's return a wrapper object containing all the stuff we found here
        return {
            peripheral,
            service,
            characteristic
        };
    }

    /**
     * Value must be a Uint8Array or Uint16Array or
     * a string like '0x01' or '0x007F' or '0x01,0x02', or '0x007F,'0x006F''
     */
    private _encodeValue(value) {
        // if it's not a string assume it's a UintXArray
        if (typeof value !== 'string') {
            return value.buffer;
        }
        const parts = value.split(',');
        if (parts[0].indexOf('x') === -1) {
            return null;
        }
        let result;
        if (parts[0].length === 4) {
            // eg. 0x01
            result = new Uint8Array(parts.length);
        } else {
            // assuming eg. 0x007F
            result = new Uint16Array(parts.length);
        }
        for (let i = 0; i < parts.length; i++) {
            result[i] = parts[i];
        }
        return result.buffer;
    }

    private nativeEncoding(encoding) {
        switch (encoding) {
            case 'utf-8':
                return NSUTF8StringEncoding;
            case 'latin2':
            case 'iso-8859-2':
                return NSISOLatin2StringEncoding;
            case 'shift-jis':
                return NSShiftJISStringEncoding;
            case 'iso-2022-jp':
                return NSISO2022JPStringEncoding;
            case 'euc-jp':
                return NSJapaneseEUCStringEncoding;
            case 'windows-1250':
                return NSWindowsCP1250StringEncoding;
            case 'windows-1251':
                return NSWindowsCP1251StringEncoding;
            case 'windows-1252':
                return NSWindowsCP1252StringEncoding;
            case 'windows-1253':
                return NSWindowsCP1253StringEncoding;
            case 'windows-1254':
                return NSWindowsCP1254StringEncoding;
            case 'utf-16be':
                return NSUTF16BigEndianStringEncoding;
            case 'utf-16le':
                return NSUTF16LittleEndianStringEncoding;
            default:
            case 'iso-8859-1':
            case 'latin1':
                return NSISOLatin1StringEncoding;
        }
    }

    private valueToNSData(value: any, encoding = 'iso-8859-1') {
        if (typeof value === 'string') {
            // return this.valueToNSData(value.split('').map(s => s.charCodeAt(0)));
            return NSString.stringWithString(value).dataUsingEncoding(this.nativeEncoding(encoding));
            // const intRef = new interop.Reference(interop.types.int8, interop.alloc(value.length));
            // for (let i = 0; i < value.length; i++) {
            //     intRef[i] = value.charCodeAt(i);
            // }
            // return NSData.dataWithBytesLength(intRef, value.length);
            // called within this class
        } else if (Array.isArray(value)) {
            // return NSKeyedArchiver.archivedDataWithRootObject(value);
            const intRef = new interop.Reference(interop.types.int8, interop.alloc(value.length));
            for (let i = 0; i < value.length; i++) {
                intRef[i] = value[i];
            }
            return NSData.dataWithBytesLength(intRef, value.length);
        } else {
            return null;
        }
    }

    private valueToString(value) {
        if (value instanceof NSData) {
            const data = new Uint8Array(interop.bufferFromData(value));
            const result = [];
            data.forEach((v, i) => (result[i] = v));
            return result;
        }
        return value;
    }
}
