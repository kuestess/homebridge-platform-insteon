'use strict';

var request = require('request');
var moment = require('moment');
var util = require('util');

var Accessory, Service, Characteristic, LastUpdate, UUIDGen;
var cachedAccessories = 0;
var platform = InsteonPlatform;

module.exports = function(homebridge) {
    console.log("homebridge API version: " + homebridge.version);
  
  	Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerPlatform("homebridge-platform-insteon", "Insteon", InsteonPlatform);

	UUIDGen = homebridge.hap.uuid;

    LastUpdate = function() {
        var self = this;

       	Characteristic.call(self, 'Last Activity', '');

       	self.setProps({
           format: Characteristic.Formats.STRING,
           perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
       	});

        self.value = self.getDefaultValue();
    };
    require('util').inherits(LastUpdate, Characteristic);
}

function InsteonPlatform(log, config) {
    
    var self = this;
    var platform = this;
    
	self.hap_accessories = {};
    
    self.config = config;
    self.log = log;
    self.host = 'https://connect.insteon.com'
    self.refreshInterval = 30 * 1000;
    self.apikey = 'APIKey ' + self.config['client_id'];
    self.log.debug('Platform definition');
	
}

InsteonPlatform.prototype.login = function(onSuccess, onFail) {
    var self = this;
    var fbody = "grant_type=password&username=" + self.config['user'] + "&password=" + self.config['pass']
        + "&client_id=" + self.config['client_id'];
    request.post({
        url : self.host + '/api/v2/oauth2/token',
        body : fbody,
        headers: {"Content-Type" : "application/x-www-form-urlencoded"}
        
    }, function (error, response, body) {
        console.log(response.statusCode);
        console.log(error);
        if (!error && response.statusCode == 200) {
            if(onSuccess) {
                var jsonObj = JSON.parse(body);
                self.SecurityToken = jsonObj.access_token;
                self.log.debug('SecurityToken: [%s]', self.SecurityToken);
                onSuccess.call(self);
            		}
            }
    });
}

InsteonPlatform.prototype.getDevices = function(onSuccess, onFail) {
    var self = this;
    var authtoken = "Bearer " + self.SecurityToken;
    
    self.log.debug('[%s]: retrieving devices', moment().format('YYYYMMDDHHmmss.SSS'));
    if(!self.SecurityToken && onFail) {
        onFail.call(self);
        return;
    }
    request.get({
        url : self.host + '/api/v2/devices?properties=all',
        headers : {
          "Content-Type" : "application/json",
  				"Authentication" : self.apikey,
  				"Authorization" : authtoken
        }
    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var json = JSON.parse(body);
                if(json.DeviceList && json.DeviceList.length > 0) {
                    var insteon_devices = [];
                    var insteon_leaksensors = [];
                    var insteonIOlincs = [];
                    
                    json.DeviceList.forEach(function(device) {
                            if(device.DeviceTypeTraits.TypeDescription === 'Dimmer Switch' || device.DeviceTypeTraits.TypeDescription === 'Dimmer Module' || device.DeviceTypeTraits.TypeDescription === 'Dimmer Micro Module') {
                            insteon_devices.push(device);}
                    })
                    onSuccess.call(self, insteon_devices);
                } else if(onFail) {
                  onFail.call(self, error, response);
                } 
        	} 
    });
}

InsteonAccessory.prototype.sendCommand = function(deviceid, command, level, callback) {
    
    var self = this;
	var base = 'https://connect.insteon.com/api/v2';
	var data = '';
	
	if (command == 'get_status'){
					data = {'command': command, 'device_id': deviceid}
				} else {
					data = {'command': command, 'level':level, 'device_id': deviceid}
				};
	
    request.post({
        		baseUrl: base,
    			json: true,
    			headers: {
    					'Authorization': self.authtoken,
        				'Authentication': self.apikey},
				url: '/commands/',
				body: data
    }, getLink);
    
    function getLink (error, response, body) {
        if(error) {
        			console.log('Error retreiving status for: ' + self.name);
        			callback(error, null);
        		}
        if (!error) {
                    if(command == 'on' || command == 'off') {
                    	callback();
                    }
                    
                    if(command == 'get_status') {
                    	var json = JSON.stringify(body);
						var linkid = JSON.parse(json).id; 
						checkStatus(linkid, function (status_body) {
						
						var level = parseInt(JSON.stringify(body.response.level),10);
						self.level = level;
						
						if (level > 0){
							self.currentState = true;
						}
						
						callback(null, status_body);
						})
        			} else {
        				return;
        			}        		
       		}
    }
       	
    function checkStatus (id) {	
		var base = 'https://connect.insteon.com/api/v2';
		var tries = 5;
		var wait = 2000;

		request.get({
			baseUrl: base,
			json: true,
			headers: {
					'Authorization': self.authtoken,
					'Authentication': self.apikey},
			url: '/commands/' + id
			},function (error, response, body) {
				console.log('SSKparsing [%s] ' + JSON.stringify(body),moment().format('YYYYMMDDHHmmss.SSS'));
				if(JSON.stringify(body.status) == 'failed') {
					callback(error, null);
				}
				
				if(JSON.parse(JSON.stringify(body)).status == 'succeeded') {
						console.log('Got success for ' + self.name + ': ' + JSON.stringify(body));
						var status_body = body
						callback(null, status_body);
				} 
				if(JSON.parse(JSON.stringify(body)).status == 'pending'){
					if(tries--) {
								setTimeout(function() {
								checkStatus(id);
								}, wait);
						} 
				}})
		}		   	
}

/*InsteonAccessory.prototype.dimmer_status = function(device_id, callback) {
    var self = this;	
    self.sendCommand.call(self, '0', self.id, 'get_status', callback);
}*/

InsteonPlatform.prototype.accessories = function(callback) {
    var self = this;
    
    self.login.call(self, function() {
        
        self.getDevices.call(self, function(insteon_devices) {  
            self.foundAccessories = [];
            insteon_devices.forEach(function(device) {
                var accessory = new InsteonAccessory(self, device);
                self.foundAccessories.push(accessory);
            });
            
            callback(self.foundAccessories);
            
            self.timer = setTimeout(self.deviceStateTimer.bind(self), self.refreshInterval);
        }, function(returnCode, errorMessage) {
            self.log.error('[%s]:Insteon Server error when list accessories, returncode=[%s], errormessage=[%s]', moment().format('YYYYMMDDHHmmss.SSS'), returnCode, errorMessage);
            throw new Error("homebridge-platform-insteon has intentially brought down HomeBridge - please restart!");
        });
    }, function(returnCode, errorMessage) {
        self.log.error('[%s]:Insteon Server error, returncode=[%s], errormessage=[%s]', moment().format('YYYYMMDDHHmmss.SSS'), returnCode, errorMessage);
        throw new Error("homebridge-platform-insteon has intentially brought down HomeBridge - please fix your configuration!");
    });
}

InsteonPlatform.prototype.deviceStateTimer = function() {
    var self = this;
    if(self.timer) {
        clearTimeout(self.timer);
        self.timer = null;
    }
    /*self.getDevices(function(insteon_devices) {
        self.foundAccessories.forEach(function(accessory) {
            accessory.updateDevice(insteon_devices);
        });
        self.timer = setTimeout(self.deviceStateTimer.bind(self), self.refreshInterval);
    });*/
}

InsteonPlatform.prototype.dateTimeToDisplay = function(unixtime) {
    return moment(unixtime, 'x').fromNow()
}

function InsteonAccessory(platform, device) {
    var self = this;
    
    self.apikey = platform.apikey;
    self.authtoken = "Bearer " + platform.SecurityToken;
    
    self.init.call(self, platform, device)
    
    platform.log.debug('[%s]: found Insteon Device, deviceid=%s', moment().format('YYYYMMDDHHmmss.SSS'), self.id);
        
    self.reachable = true;                	
	
	self.service = new Service.Lightbulb(self.name);
	
	/*self.service
		.addCharacteristic(Characteristic.LastUpdate);*/
	
	self.service
		.getCharacteristic(Characteristic.On)
		.on('get', function(callback) {
		self.log.debug("[%s]: Getting current dimmer state for [%s]...", moment().format('YYYYMMDDHHmmss.SSS'), self.name);
		self.sendCommand.call(self, self.id, 'get_status', 0, function(error, body){
			if(error){
				console.log('Error retrieving status of ' + self.name);
				callback(error,null); 
			}
					
			var level = parseInt(JSON.stringify(body.response.level),10);
			self.level = level;
			console.log('SSKFinal: ' + JSON.stringify(body) + ' Level: ' + level);
			
			 if(level > 0) {
				self.currentState = true;
				console.log('Setting Characteristic.On to ' + self.currentState + 'for ' + self.name);
				self.service.getCharacteristic(Characteristic.On).updateValue(self.currentState);
				
				callback(null, self.currentState);
				
			  } else {
				self.currentState = false;
				callback(null, self.currentState);
			  }
		});
	}.bind(self));
	
	self.service
		.addCharacteristic(Characteristic.Brightness)
			.on('get', function(callback) {
				
				self.service.getCharacteristic(Characteristic.Brightness).updateValue(self.level);
				callback(null, self.level);
			}.bind(self));
		
	self.service
		.getCharacteristic(Characteristic.On)	
		.on('set', function(state, callback) {
				
			if(state !== self.currentState) {
				self.log.debug("[%s]: set current dimmer state...[%s]", moment().format('YYYYMMDDHHmmss.SSS'), state);
			
			
			if(state == 0) {	
					console.log('Sending OFF to ' + self.name);
					self.sendCommand.call(self, self.id, 'off', 0, function(body){
				
					self.currentState = false;
					self.level = 0;
					self.stateUpdatedTime = moment().format('x');

					self.service.getCharacteristic(Characteristic.On).updateValue(self.currentState);
					//self.service.getCharacteristic(LastUpdate).setValue(self.platform.dateTimeToDisplay(self.stateUpdatedTime));
					callback();
				});
			}	
			
			if(state == 1) {	
					console.log('Sending ON to ' + self.name);
					self.sendCommand.call(self, self.id, 'on', 100, function(body){
				
					self.currentState = true;
					self.level = 100;
					self.stateUpdatedTime = moment().format('x');

					self.service.getCharacteristic(Characteristic.On).updateValue(self.currentState);
					//self.service.getCharacteristic(LastUpdate).setValue(self.platform.dateTimeToDisplay(self.stateUpdatedTime));
					callback();
				});
			}
			} else {
				callback();
			}
		}.bind(self));
	
	self.service
		.getCharacteristic(Characteristic.Brightness)
			.on('set', function(level, callback) {
				
				self.sendCommand.call(self, self.id, 'on', level, function(body){
				
					self.level = level;
					self.stateUpdatedTime = moment().format('x');

					self.service.getCharacteristic(Characteristic.Brightness).updateValue(self.level);
					//self.service.getCharacteristic(LastUpdate).setValue(self.platform.dateTimeToDisplay(self.stateUpdatedTime));
					callback();
				});				
			}.bind(self));
	
}

InsteonAccessory.prototype.init = function(platform, device) {
    var self = this;

    self.platform = platform;
    self.log = platform.log;
    self.id = +device.DeviceID;
    self.currentState = '';
    self.level = '';
    self.name = device.DeviceName;
    self.insteonID = device.InsteonID;
    self.deviceType = device.DeviceTypeTraits.TypeDescription;
    self.reachable = true;
    
    self.updateDevice([device]);  
}

InsteonAccessory.prototype.addService = function(accessory, service_name, service_type) {

  var isValid;

  if (typeof Service[service_type] !== "undefined") {
    accessory.addService(Service[service_type], service_name, service_name);
    
    this.service_types[service_name] = service_type;
    
    if (typeof accessory.context.service_types === "undefined") {
      accessory.context.service_types = {};
    }
    accessory.context.service_types[service_name] = service_type;
    
    isValid = true;
  } else {
    isValid = false;
  }
  
  return isValid;
}

InsteonAccessory.prototype.descState = function(state) {
    switch(state) {
        case Characteristic.CurrentDimmerState.ON:
        return 'on';
        case Characteristic.CurrentDimmerState.OFF:
        return 'off';
        default:
        return state;
    }
}

InsteonAccessory.prototype.updateDevice = function(devices) {
    var self = this;
    var isMe = false;
    if(!devices) {
        return false;
    }
    
    if (self.deviceType == ('Dimmer Switch' || 'Dimmer Module' || 'Dimmer Micro Module')) {
    	var serviceType = 'Service.Lightbulb';
    	};
    
    if (self.deviceType == 'Leak Sensor') {
    	var serviceType = 'Service.LeakSensor';
    	};
    
     if (self.deviceType == 'I/O Module') {
    	var serviceType = 'Service.GarageDoorOpener';
    	};
    
    for(var i=0; i< devices.length; i++){
        //self.log.debug('updateDevice ' + devices[i].DeviceID);
        
        self.addService(self, self.name, serviceType)
        
        if(!self.device || self.device.DeviceID === devices[i].DeviceID) {
            self.device = devices[i];
            isMe = true;
            break;
        }
    }
    if(!isMe || !self.device) {
        return false;
    }
    return true;
}

InsteonAccessory.prototype.getServices = function() {
    var self = this;
    var services = [];
    var service = new Service.AccessoryInformation();
    
    service.setCharacteristic(Characteristic.Name, self.DeviceName)
        .setCharacteristic(Characteristic.Manufacturer, 'Insteon')
        .setCharacteristic(Characteristic.Model, 'Insteon')
        .setCharacteristic(Characteristic.SerialNumber, self.insteonID || '')
        .setCharacteristic(Characteristic.FirmwareRevision, self.FirmwareVersion || '')
        .setCharacteristic(Characteristic.HardwareRevision, '');
    services.push(service);
    if(self.service) {
        services.push(self.service);
    }
    return services;
}

function InsteonLeakSensorAccessory (platform, device) {

}


function InsteonIOLincAccessory (platform, device) {

}

InsteonLeakSensorAccessory.prototype.init = function(platform, device) {
    var self = this;

    self.platform = platform;
    self.log = platform.log;
    self.id = +device.DeviceID;
    self.sensorstatus = '';
    self.name = device.DeviceName;
    self.insteonID = device.InsteonID;
    self.deviceType = device.DeviceTypeTraits.TypeDescription;
    self.reachable = true;
    
    self.updateDevice([device]);
}

InsteonIOLincAccessory.prototype.init = function(platform, device) {
    var self = this;

    self.platform = platform;
    self.log = platform.log;
    self.id = +device.DeviceID;
    self.sensorstatus = '';
    self.relaystatus = '';
    self.name = device.DeviceName;
    self.insteonID = device.InsteonID;
    self.deviceType = device.DeviceTypeTraits.TypeDescription;
    self.reachable = true;
    
    self.updateDevice([device]);
}