const Accessory = require('../').Accessory
const Service = require('../').Service
const Characteristic = require('../').Characteristic
const uuid = require('../').uuid
const miio = require('miio')


const outputLogs = false

/* Accessory Modes

  Note: every mode includes ability to enable MANUAL (favorite) mode
  On `set rotation speed` action MANUAL state (favorite mode) automatically enables

  0:
    - No ability to enable `silent` mode
    - On accessory power on/off Air Purifier turns on/off
  1:
    - Silent mode is enabled by a separate Switch Accessory
    - On accessory power on/off Air Purifier turns on/off
  2:
    - No ability to power off Air Purifier
    - On accessory power off Air Purifier turns it's silent mode on,
      on accessory power on Air Purifier turns it's auto mode on
    - If Air Purifier's state is idle (powered off), 
      it can be powered on by enabling accessory in the Home app
  3:
    - On accessory power on/off Air Purifier turns on/off
    - On set target state MANUAL Purifier goes Silent
    - On set rotation speed (any change) it goes favorite,
      target state goes MANUAL, leaving only "AUTO" button to disable FAVORITE

  Set `accessoryMode` to the prefered mode
  Default is 2 (does anyone ever need to turn off Mi Air Purifier??)

*/

const accessoryMode = 3


const showTemperature = true
const showHumidity = true
const showAirQuality = true

// Mi Air Purifier [2] modes: https://github.com/aholstenson/miio/blob/master/docs/devices/air-purifier.md
const PurifierModes = {  
  IDLE: 'idle',
  AUTO: 'auto',
  SILENT: 'silent',
  FAVORITE: 'favorite',
}

const LedBrightness = {
  modes: ['bright', 'dim', 'off'],
  getNext: function(current) {
    const index = this.modes.indexOf(current) + 1
    if (index < this.modes.length) {
      return this.modes[index]
    } else { return this.modes[0] }
  },
}

const deviceNotConnected = ' is not connected!'

var airQualityLevels = [
  [200, Characteristic.AirQuality.POOR],
  [150, Characteristic.AirQuality.INFERIOR],
  [100, Characteristic.AirQuality.FAIR],
  [50, Characteristic.AirQuality.GOOD],
  [0, Characteristic.AirQuality.EXCELLENT],
]

function getAirQualityFromPM2_5(pm2_5) {
  var quality = Characteristic.AirQuality.UNKNOWN
  for (var item of airQualityLevels) {
    if (pm2_5 >= item[0]){
      quality = item[1]
      break
    }
  }
  return quality
}


var MiAirPurifier2 = {
  name: 'Air Purifier 2',  // name of the accessory
  pincode: '000-69-777',  // password to add HomeKit device. You can change numbers keeping '-' symbols
  username: 'AA:BB:CC:DD:EE:FF',  // MAC like address used by HomeKit to differentiate accessories.
  model: 'zhimi.airpurifier.m1',  // model (optional for homekit and miio)

  // Optional parameters to be shown in the Home app
  manufacturer: 'Xiaomi',
  serialNumber: "12345678",  // your air purifier's serial number
  firmware: '1.2.4',  // your air purifier's firmware version (underscores not supported)

  device: undefined,  // will be set after discovering the device

  address: '192.168.1.77',  // purifuer's IP. It's required for miio to discover device

  // It works well without token after running in terminal `miio discover --sync`, miio will resolve token automatically
  // So if you don't want to provide device's token don't forget to comment out lines 97 and 364
  // It's totally unnecessary to provide token now but it's better to save it because it may be hidden with future device's software updates 
  token: '2b26525b0674c61e1893bc74fd2f38d6',

  // // The value property of CurrentAirPurifierState must be one of the following:
  // Characteristic.CurrentAirPurifierState.INACTIVE = 0;
  // Characteristic.CurrentAirPurifierState.IDLE = 1;
  // Characteristic.CurrentAirPurifierState.PURIFYING_AIR = 2;
  // READ ONLY: https://github.com/KhaosT/HAP-NodeJS/blob/72513c067531a00fc5f2e0e99fc8e16e8d2ee97d/lib/gen/HomeKitTypes.js#L422
  // In case Mi AirPurifier's mode 'idle' equals powered off, value 1 will be never used
  currentAirPurifierState: 0,

  // // The value property of TargetAirPurifierState must be one of the following:
  // Characteristic.TargetAirPurifierState.MANUAL = 0;
  // Characteristic.TargetAirPurifierState.AUTO = 1;
  // READ & WRITE: https://github.com/KhaosT/HAP-NodeJS/blob/1f6c2728e1ad51e2711abba6779a72b522f84b34/lib/gen/HomeKitTypes.js#L2096
  targetAirPurifierState: 1,


  identify: function(callback, paired) {
    if(outputLogs) console.log('%s identify. Paired: %s', this.name, paired)
    if(this.device) {
      if(outputLogs) console.log('Starting blink!')
      this.device.ledBrightness(LedBrightness.getNext(this.device.ledBrightness()))
        .then(brightness => this.device.ledBrightness(LedBrightness.getNext(brightness)))
        .then(brightness => this.device.ledBrightness(LedBrightness.getNext(brightness)))
        .then(brightness => {
          if(outputLogs) console.log('Blinked successfully!')
          callback()
        })
        .catch(err => {
          const errLine = 'Error getting current brightness: ' + err
          if(outputLogs) console.log(errLine)
          callback(new Error(errLine))
        })
      } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  getCurrentTemperature: function(callback) { 
    if(outputLogs) console.log('Get temperature')
    if(this.device) {
      this.device.temperature()
        .then(temperature => callback(null, temperature.celsius))
        .catch(err => {
          const errLine = 'Error getting temperature: ' + err
          if(outputLogs) console.log(errLine)
          callback(new Error(errLine))
        })
      } else { callback(new Error(this.name + deviceNotConnected)) }
    },

  getCurrentRelativeHumidity: function(callback) {
    if(outputLogs) console.log('Get current relative humidity')
    if(this.device) {
      this.device.relativeHumidity()
        .then(rh => callback(null, rh))
        .catch(err => {
          const errLine = 'Error getting relative humidity: ' + err
          if(outputLogs) console.log(errLine)
          callback(new Error(errLine))
        })
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  getAirQuality: function(callback) {
    if(outputLogs) console.log('Get air quality (in words)')
    if(this.device) {
      this.device.pm2_5()
        .then(pm2_5 => callback(null, getAirQualityFromPM2_5(pm2_5)))
        .catch(err => {
          const errLine = 'Error getting air quality in words: ' + err
          if(outputLogs) console.log(errLine)
          callback(new Error(errLine))
        })
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  getPM2_5Density: function(callback) {
    if(outputLogs) console.log('Get air quality (PM2.5)')
    if(this.device) {
      this.device.pm2_5()
        .then(pm2_5 => callback(null, pm2_5))
        .catch(err => {
          const errLine = 'Error getting air quality in PM2.5: ' + err
          if(outputLogs) console.log(errLine)
          callback(new Error(errLine))
        })
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  getCurrentAirPurifierState: function(callback) {
    if(outputLogs) console.log('Get current air purifier state')
    if(this.device) {
      callback(null, this.currentAirPurifierState)
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  getRotationSpeed: function(callback) {
    if(outputLogs) console.log('Get rotation speed')
    if(this.device) {
      this.device.favoriteLevel()
        .then(level => callback(null, level * 6.25))
        .catch(err => {
          const errLine = 'Error getting rotation speed: ' + err
          if(outputLogs) console.log(errLine)
          callback(new Error(errLine))
        })
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  setRotationSpeed: function(callback, speed) {
    if(outputLogs) console.log('Set rotation speed to', speed)
    if (this.device) {
      this.device.mode()
        .then(mode => {
          if (mode != PurifierModes.FAVORITE) {
            if(outputLogs) console.log('Current mode is %s, changing to %s', mode, PurifierModes.FAVORITE)
            this.device.setMode(PurifierModes.FAVORITE)
              .then(m => { if(outputLogs) console.log('Successfully changed state to', m) })
              .catch(err => { if(outputLogs) console.log('Error setting mode! Error is:', err) })
          }
        })
        .catch(err => { if(outputLogs) console.log('Error getting %s mode!: %s', this.name, err) })

      this.device.setFavoriteLevel(Math.ceil(speed / 6.25))
        .then(() => {
          if(outputLogs) console.log('Set %s favorite level to %s percent', this.name, speed)
          callback()
        })
        .catch(err => {
          const errLine = 'Error setting rotation speed: ' + err
          if(outputLogs) console.log(errLine)
          callback(new Error(errLine))
        })
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  getActiveState: function(callback) {
    if(outputLogs) console.log('Get active state (power)')
    if(this.device) {
      if (accessoryMode == 2) {
        this.device.mode()
          .then(mode => {
            if ((mode == PurifierModes.SILENT) || (mode == PurifierModes.IDLE)) {
              callback(null, false)
            } else { callback(null, true) }
          })
          .catch(err => {
            const errLine = 'Error getting mode: ' + err
            if(outputLogs) console.log(errLine)
            callback(new Error(errLine))
          })
      } else { 
        this.device.power()
          .then(power => callback(null, power))
          .catch(err => {
            const errLine = 'Error getting active state (power): ' + err
            if(outputLogs) console.log(errLine)
            callback(new Error(errLine))
          })
      }
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  setActiveState: function(callback, active) {
    if(outputLogs) console.log('Set active state to', active)
    if (this.device) {
      if ((accessoryMode == 2) && (active == 0)) {
        this.device.setMode(PurifierModes.SILENT)
          .then(mode => {
            if(outputLogs) console.log('Set %s mode to %s (active state to %s)', this.name, mode, active)
            callback()
            updateCurrentState(0)
          })
          .catch(err => {
            const errLine = 'Error changing active state (setting SILENT): ' + err
            if(outputLogs) console.log(errLine)
            callback(new Error(errLine))
          })        
      } else {
        this.device.setPower(Boolean(active))
          .then(power => {
            if(outputLogs) console.log('Set %s active state to %s', this.name, active)
            callback()
          updateCurrentState(active * 2)
          })
          .catch(err => {
            const errLine = 'Error setting active state (power): ' + err
            if(outputLogs) console.log(errLine)
            callback(new Error(errLine))
          })
      }
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  getTargetAirPurifierState: function(callback) {
    if(outputLogs) console.log('Get target air purifier state')
    if(this.device) {
      callback(null, this.targetAirPurifierState)
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  setTargetAirPurifierState: function(callback, state) {
    if(outputLogs) console.log('Set target air purifier state to', state)
    if(this.device) {
      this.device.setMode(state ? PurifierModes.AUTO : (accessoryMode == 3 ? PurifierModes.SILENT : PurifierModes.FAVORITE))
        .then(mode => {
          this.targetAirPurifierState = state
          if(outputLogs) console.log('Set %s target state to %s', this.name, mode)
          callback()
        })
        .catch(err => {
          const errLine = 'Error setting target state: ' + err
          if(outputLogs) console.log(errLine)
          callback(new Error(errLine))
        })
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  getExternalSwitch: function(callback) {
    if(outputLogs) console.log('Get air purifier silent mode enabled')
    if(this.device) {
      this.device.mode()
        .then(mode => {
          if(outputLogs) console.log('%s mode is %s', this.name, mode)
          callback(null, (mode == PurifierModes.SILENT))
        })
        .catch(err => {
          const errLine = 'Error getting mode: ' + err
          if(outputLogs) console.log(errLine)
          callback(new Error(errLine))
        })
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

  setExternalSwitch: function(callback, value) {
    if(outputLogs) console.log('Set air purifier silent mode enabled to', value)
    if(this.device) {
      this.device.setMode(value ? PurifierModes.SILENT : PurifierModes.AUTO)
        .then(mode => {
          if(outputLogs) console.log('Set %s mode to %s', this.name, mode)
          callback()
        })
        .catch(err => {
          const errLine = 'Error setting silent mode: ' + err
          if(outputLogs) console.log(errLine)
          callback(new Error(errLine))
        })
    } else { callback(new Error(this.name + deviceNotConnected)) }
  },

}


// Generate a consistent UUID for our Air Purifier Accessory that will remain the same
// even when restarting our server. We use the `uuid.generate` helper function to create
var airPurifierUUID = uuid.generate('hap-nodejs:accessories:AirPurifier:' + MiAirPurifier2.username)

// This is the Accessory that we'll return to HAP-NodeJS that represents our Mi Air Purifier 2.
var airPurifier = exports.accessory = new Accessory(MiAirPurifier2.name, airPurifierUUID)

// Add properties for publishing (in case we're using Core.js and not BridgedCore.js)
airPurifier.username = MiAirPurifier2.username
airPurifier.pincode = MiAirPurifier2.pincode


// Initialize connection to Mi Air Purifier 2
miio.device({
  address: MiAirPurifier2.address,
  token: MiAirPurifier2.token,  // comment this line if you don't want to provide token
  model: MiAirPurifier2.model,  // not required
}).then(device => {
  if(outputLogs) console.log('Connection to Mi Air Purifier 2 inited')

  device.on('temperatureChanged', temperature => {
    if(outputLogs) console.log('temperature is now', temperature)
    updateTemperature(temperature.celsius)
  })

  device.on('relativeHumidityChanged', humidity => {
    if(outputLogs) console.log('humidity is now', humidity)
    updateHumidity(humidity)
  })

  device.on('pm2.5Changed', pm2_5 => {
    if(outputLogs) console.log('pm2.5 (aqi) is now', pm2_5)
    updateAirQuality(pm2_5)
  })

  device.on('modeChanged', mode => {
    if(outputLogs) console.log('Mode is now', mode)
    var modeSilent = mode == PurifierModes.SILENT
    switch (accessoryMode) {
      case 1:
        updateExternalSwitch(modeSilent)
        break
      case 2:
        var active = (modeSilent || mode == PurifierModes.IDLE) ? 0 : 1
        updateActiveState(active)
        updateCurrentState(active * 2)
        break
    }
    updateMode(mode)
  })

  device.on('powerChanged', power => {
    if(outputLogs) console.log('Power is now', power)
    if ((accessoryMode == 1) && (power == false)) updateExternalSwitch(false)
    updateActiveState(power ? 1 : 0)
  })

  MiAirPurifier2.device = device

}).catch(e => {
    console.log('Error connecting:\n', e)
    console.log('%s not connected!\nDidn\'t you forget to run `miio discover --sync`?', MiAirPurifier2.name)
})


// set some basic properties (these values are arbitrary and setting them is optional)
airPurifier
  .getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, MiAirPurifier2.manufacturer)
    .setCharacteristic(Characteristic.Model, MiAirPurifier2.model)
    .setCharacteristic(Characteristic.SerialNumber, MiAirPurifier2.serialNumber)
    .setCharacteristic(Characteristic.FirmwareRevision, MiAirPurifier2.firmware)

// listen for the "identify" event for this Accessory
airPurifier.on('identify', function(paired, callback) {
  MiAirPurifier2.identify(callback, paired)
})


airPurifier
  .addService(Service.AirPurifier, MiAirPurifier2.name)

// Is powered on or off (ACTIVE or INACTIVE)
airPurifier
  .getService(Service.AirPurifier)
  .getCharacteristic(Characteristic.Active)
  .on('set', function(value, callback) { MiAirPurifier2.setActiveState(callback, value) })
  .on('get', function(callback) { MiAirPurifier2.getActiveState(callback) })

// Purifier states: INACTIVE, IDLE, PURIFYING_AIR
airPurifier
  .getService(Service.AirPurifier)
  .getCharacteristic(Characteristic.CurrentAirPurifierState)
  .on('get', function(callback) {  MiAirPurifier2.getCurrentAirPurifierState(callback) })

// Desired mode: MANUAL or AUTO
airPurifier
  .getService(Service.AirPurifier)
  .getCharacteristic(Characteristic.TargetAirPurifierState)
  .on('set', function(value, callback) { MiAirPurifier2.setTargetAirPurifierState(callback, value) })
  .on('get', function(callback) { MiAirPurifier2.getTargetAirPurifierState(callback) })

airPurifier
  .getService(Service.AirPurifier)
  .getCharacteristic(Characteristic.RotationSpeed)
  .on('set', function(value, callback) { MiAirPurifier2.setRotationSpeed(callback, value) })
  .on('get', function(callback) { MiAirPurifier2.getRotationSpeed(callback) })

if (accessoryMode == 1) {
  airPurifier
    .addService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .on('set', function(value, callback) { MiAirPurifier2.setExternalSwitch(callback, value) })
    .on('get', function(callback) { MiAirPurifier2.getExternalSwitch(callback) })

  airPurifier
    .getService(Service.Switch)
    .addCharacteristic(Characteristic.Name)
    .setValue('Silent ' + MiAirPurifier2.name)
}

// Plus additional sensors which Mi Air Purifier 2 has

// Add Temperature Sensor service
if (showTemperature) {
  airPurifier
    .addService(Service.TemperatureSensor)
    .getCharacteristic(Characteristic.CurrentTemperature)
    .on('get', function(callback) { MiAirPurifier2.getCurrentTemperature(callback) })
}

// Add Humidity Sensor service
if (showHumidity) {
  airPurifier
    .addService(Service.HumiditySensor)
    .getCharacteristic(Characteristic.CurrentRelativeHumidity)
    .on('get', function(callback) { MiAirPurifier2.getCurrentRelativeHumidity(callback) })
}

// Add AirQuality Sensor service
if (showAirQuality) {

  airPurifier
    .addService(Service.AirQualitySensor)
    .getCharacteristic(Characteristic.AirQuality)
    .on('get', function(callback) { MiAirPurifier2.getAirQuality(callback) })

  airPurifier
    .getService(Service.AirQualitySensor)
    .addCharacteristic(Characteristic.PM2_5Density)
    .on('get', function(callback) { MiAirPurifier2.getPM2_5Density(callback) })
}


//

function updateExternalSwitch(state) {
  airPurifier
    .getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .updateValue(state)
}

function updateActiveState(active) {
  airPurifier
    .getService(Service.AirPurifier)
    .getCharacteristic(Characteristic.Active)
    .updateValue(active)
  updateCurrentState(active * 2)
}

function updateCurrentState(value) {
  MiAirPurifier2.currentAirPurifierState = value
  airPurifier
    .getService(Service.AirPurifier)
    .getCharacteristic(Characteristic.CurrentAirPurifierState)
    .updateValue(MiAirPurifier2.currentAirPurifierState)
}

function updateTargetState() {
  airPurifier
    .getService(Service.AirPurifier)
    .getCharacteristic(Characteristic.TargetAirPurifierState)
    .updateValue(MiAirPurifier2.targetAirPurifierState)
}

function updateMode(mode) {
  if (mode == PurifierModes.FAVORITE || ((accessoryMode == 3) && (mode == PurifierModes.SILENT))) {
    MiAirPurifier2.targetAirPurifierState = Characteristic.TargetAirPurifierState.MANUAL
  } else {
    MiAirPurifier2.targetAirPurifierState = Characteristic.TargetAirPurifierState.AUTO
  }
  updateTargetState()
}

function updateTemperature(temperature) {
  airPurifier
    .getService(Service.TemperatureSensor)
    .getCharacteristic(Characteristic.CurrentTemperature)
    .updateValue(temperature)
}

function updateHumidity(humidity) {
  airPurifier
    .getService(Service.HumiditySensor)
    .getCharacteristic(Characteristic.CurrentRelativeHumidity)
    .updateValue(humidity)
}

function updateAirQuality(pm2_5) {
  airPurifier
    .getService(Service.AirQualitySensor)
    .getCharacteristic(Characteristic.AirQuality)
    .updateValue(getAirQualityFromPM2_5(pm2_5))

  airPurifier
    .getService(Service.AirQualitySensor)
    .getCharacteristic(Characteristic.PM2_5Density)
    .updateValue(pm2_5)
}

setInterval(function() {
  // We need to keep the device up and running
  // so lets trigger any device's method to keep it alive.
  // If we don't use this method HAP will tell us that there
  // is no reponse for a minute or so if we try to change anything
  if (showTemperature)
    MiAirPurifier2.getCurrentTemperature(function (n, temperature) {
      updateTemperature(temperature)
    })
  else
    MiAirPurifier2.device.power()
}, 300000);
