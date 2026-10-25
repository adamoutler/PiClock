/**
 * replacement for piclock using node and html tmehrkam@gmail.com
 */
var http = require('http');
var request = require('request');
var fs = require("fs");
var path = require('path');
var d2d = require('degrees-to-direction')
var util = require('util');
var trend = require('trend');
var getPromise = util.promisify(request.get);
var DOMParser = require('@xmldom/xmldom').DOMParser;
var geoTz = require('geo-tz');
var SunCalc = require('suncalc');
const { exec } = require('child_process');

//Read settings
const settings = JSON.parse(fs.readFileSync('./settings.json'))

//get current weather conditions
var cur={};
//initialize json of arrays
var store={};
store.timestamp=[];
store.temp=[];
store.pressure=[];
store.humidity=[];
var forecasts = {};
var alerts = {};
var nightMode = false;

cur.dt=0;
alerts.features =[];

currentDsObs();
currentOwObs();
currentCcObs();
currentWgovObs();
currentWaObs();
currentVcObs();

setInterval(function() {
		currentDsObs();
		currentOwObs();
		currentCcObs();
		currentWaObs();
		currentVcObs();
}, 600 * 1000);

//Logging
var winston = require('winston');
require('winston-daily-rotate-file');
const NODE_ENV = process.env.NODE_ENV;
const myFormat = winston.format.printf(info => {
	return `${info.timestamp} ${info.level}: ${info.message}`;
});


var transport = new (winston.transports.DailyRotateFile)({
  filename: 'apitest-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d'
});

transport.on('rotate', function(oldFilename, newFilename) {
  // do something fun
});

const logger = winston.createLogger({
	level: NODE_ENV === "production" ? 'warn' : 'info',
			transports: [
			      transport
			    ],
			 format: winston.format.combine(
				winston.format.timestamp({
					format: 'YYYY-MM-DD hh:mm:ss A ZZ'
				}),
				winston.format.colorize({ all: true }),
				winston.format.simple(),
				myFormat
		),
});

async function currentOwObs(){
	var url = 'http://api.openweathermap.org/data/2.5/weather?lat='+settings.lat+'&lon='+settings.lon+'&appid='+settings.owAppId+'&units=imperial'

	var { body } = await getPromise({
		url: url,
		json: true,
		headers: {'User-Agent': 'piclockjs'}
	});
	parseOW(body);
}

async function currentDsObs(){
	var url = 'https://api.darksky.net/forecast/'+settings.dsAppId+'/'+settings.lat+','+settings.lon;

	var { body } = await getPromise({
		url: url,
		json: true,
		headers: {'User-Agent': 'piclockjs'}
	});
	parseDS(body);
}

async function currentCcObs(){
	var url = 'https://api.tomorrow.io/v4/timelines?location=' + settings.lat + '%2C' + settings.lon + '&units=imperial&fields=temperature%2CtemperatureApparent%2Chumidity%2CwindSpeed%2CweatherCode%2CwindDirection%2CpressureSurfaceLevel&timesteps=current'
		
	var { body } = await getPromise({
		url: url,
		json: true,
		headers: {'User-Agent': 'piclockjs',
			'apikey' : settings.ccAppId,
			'accept' : 'application/json'
		}
	});
	
	parseCC(body.data.timelines[0].intervals[0].values);
}

async function currentWaObs(){
	var url = 'http://api.weatherapi.com/v1/current.json?key='+settings.waAppId+'&q='+settings.lat+','+settings.lon+'&aqi=no';
	
	var { body } = await getPromise({
		url: url,
		json: true,
		headers: {
			'User-Agent': 'piclockjs',
			'accept' : 'application/json'
		}
	});
	
	parseWA(body);
}

async function currentWgovObs(){
	var url ="https://api.weather.gov/stations/KJYO/observations";
		
	var { body } = await getPromise({
		url: url,
		json: true,
		headers: {'User-Agent': 'piclockjs',
			'accept' : 'application/json'
		}
	});
	parseWgov(body);
}

async function currentVcObs(){
	var url = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/"+settings.lat+"%2C"+settings.lon+"/today?unitGroup=us&key="+settings.vcAppId+"&include=current"
	
	var { body } = await getPromise({
		url: url,
		json: true,
		headers: {'User-Agent': 'piclockjs',
			'accept' : 'application/json'
		}
	});
	parseVc(body.currentConditions);
}

function parseVc(observation){
	logger.info('visualcrossing : ' + observation.temp + ' : ' + observation.conditions);
}

function parseOW(observation){
	var now = new Date();
	var update = new Date(0);
	
	update.setUTCSeconds(observation.dt);
	
	var diffMs = (now - update); // diff in MS
	var diffMins = Math.round(diffMs / 1000 / 60); // minutes
	
	logger.info('openweather : ' + observation.main.temp + " : " + diffMins + ' : ' + observation.weather[0].main);
}

function parseDS(body){
	var observation = body.currently;
	
	var now = new Date();
	var update = new Date(0);
	
	update.setUTCSeconds(observation.time);
	
	var diffMs = (now - update); // diff in MS
	var diffMins = Math.round(diffMs / 1000 / 60); // minutes

	logger.info('darksky : ' + parseFloat(observation.temperature) + " : " + diffMins + " : " + observation.summary);
}

function parseCC(body){
	logger.info('climacell : ' + body.temperature + ' : ' + ccIcon(body.weatherCode).text);
}

function parseWA(body){
	logger.info('weatherapi : ' + body.current.temp_f + ' : ' + body.current.condition.text);
}

function parseWgov(body){
	observation = body.features[0].properties;
	
	var now = new Date();
	update = new Date(observation.timestamp);
	
	var diffMs = (now - update); // diff in MS
	var diffMins = Math.round(diffMs / 1000 / 60); // minutes
	var temp;
	if (observation.temperature.value){
		temp = observation.temperature.value;
	} else {
		var metar = observation.rawMessage.toString();
		temp = metar.match(/(\d{2})\//)[1];
		//logger.info("metar temp : " + temp[1]);
	}
	temp_f = parseInt(temp) * 1.8 + 32;
	
	logger.info('usg : ' + temp_f + " F : timestamp age = " + diffMins + " : "  + observation.textDescription);
}


function ccIcon(description){

	var now = new Date();
	var sunrise = new Date(cur.sunrise);
	var sunset = new Date(cur.sunset);

	var day;

	if (now > sunrise && now < sunset) {
		day = true;
	} else {
		day = false;
	}

	if (description == "4201"){
		if (day) {
			var icon = '<i class="wi wi-day-rain"></i>';
		} else {
			var icon = '<i class="wi wi-night-rain"></i>';
		}
	} else if (description == "rain_heavy") {
		return {
			icon: icon,
			text: "Heavy Rain"
		};
	} else if (description == "4001") {
		if (day) {
			var icon = '<i class="wi wi-day-rain"></i>';
		} else {
			var icon = '<i class="wi wi-night-rain"></i>';
		}
		return {
			icon: icon,
			text: "Rain"
		};
	} else if (description == "4200") {
		if (day) {
			var icon = '<i class="wi wi-day-sprinkle"></i>';
		} else {
			var icon = '<i class="wi wi-night-alt-sprinkle"></i>';
		}
		return {
			icon: icon,
			text: "Light Rain"
		};
	} else if (description == "6201") {
		if (day) {
			var icon = '<i class="wi wi-day-rain-mix"></i>';
		} else {
			var icon = '<i class="wi-night-rain-mix"></i>';
		}
		return {
			icon: icon,
			text: "Heavy Freezing Rain"
		};
	} else if (description == "6001") {
		if (day) {
			var icon = '<i class="wi wi-day-sleet"></i>';
		} else {
			var icon = '<i class="wi wi-night-sleet"></i>';
		}
		return {
			icon: icon,
			text: "Freezing Rain"
		};
	} else if (description == "6200") {
		if (day) {
			var icon = '<i class="wi wi-day-sleet"></i>';
		} else {
			var icon = '<i class="wi wi-night-sleet"></i>';
		}
		return {
			icon: icon,
			text: "Freezing Light Rain"
		};
	} else if (description == "6000") {
		if (day) {
			var icon = '<i class="wi wi-day-sleet"></i>';
		} else {
			var icon = '<i class="wi wi-night-alt-showers"></i>';
		}
		return {
			icon: icon,
			text: "Freezing Drizzle"
		};
	} else if (description == "4000") {
		if (day) {
			var icon = '<i class="wi wi-day-showers"></i>';
		} else {
			var icon = '<i class="wi wi-night-sprinkle"></i>';
		}
		return {
			icon: icon,
			text: "Drizzle"
		};
	} else if (description == "7101") {
		if (day) {
			var icon = '<i class="wi wi-day-hail"></i>';
		} else {
			var icon = '<i class="wi wi-night-hail"></i>';
		}
		return {
			icon: icon,
			text: "Heavy Ice Pellets"
		};
	} else if (description == "7000") {
		if (day) {
			var icon = '<i class="wi wi-day-hail"></i>';
		} else {
			var icon = '<i class="wi wi-night-hail"></i>';
		}
		return {
			icon: icon,
			text: "Ice Pellets"
		};
	} else if (description == "7102") {
		if (day) {
			var icon = '<i class="wi wi-day-snow"></i>';
		} else {
			var icon = '<i class="wi wi-night-snow"></i>';
		}
		return {
			icon: icon,
			text: "Light Ice Pellets"
		};
	} else if (description == "5101") {
		if (day) {
			var icon = '<i class="wi wi-day-snow"></i>';
		} else {
			var icon = '<i class="wi wi-night-snow"></i>';
		}
		return {
			icon: icon,
			text: "Heavy Snow"
		};
	} else if (description == "5000") {
		if (day) {
			var icon = '<i class="wi wi-day-snow"></i>';
		} else {
			var icon = '<i class="wi wi-night-snow"></i>';
		}
		return {
			icon: icon,
			text: "Snow"
		};
	} else if (description == "5100") {
		if (day) {
			var icon = '<i class="wi wi-day-snow"></i>';
		} else {
			var icon = '<i class="wi wi-night-snow"></i>';
		}
		return {
			icon: icon,
			text: "Light snow"
		};
	} else if (description == "5001") {
		if (day) {
			var icon = '<i class="wi wi-day-snow"></i>';
		} else {
			var icon = '<i class="wi wi-night-snow"></i>';
		}
		return {
			icon: icon,
			text: "Flurries"
		};
	} else if (description == "8000") {
		if (day) {
			var icon = '<i class="wi wi-day-thunderstorm"></i>';
		} else {
			var icon = '<i class="wi wi-night-thunderstorm"></i>';
		}
		return {
			icon: icon,
			text: "Thunderstorm"
		};
	} else if (description == "2100") {
		if (day) {
			var icon = '<i class="wi wi-day-fog"></i>';
		} else {
			var icon = '<i class="wi wi-night-fog"></i>';
		}
		return {
			icon: icon,
			text: "Light Fog"
		};
	} else if (description == "2000") {
		if (day) {
			var icon = '<i class="wi wi-fog"></i>';
		} else {
			var icon = '<i class="wi wi-fog"></i>';
		}
		return {
			icon: icon,
			text: "Fog"
		};
	} else if (description == "1001") {
		if (day) {
			var icon = '<i class="wi wi-cloudy"></i>';
		} else {
			var icon = '<i class="wi wi-cloudy"></i>';
		}
		return {
			icon: icon,
			text: "Cloudy"
		};
	} else if (description == "1102") {
		if (day) {
			var icon = '<i class="wi wi-day-sunny-overcast"></i>';
		} else {
			var icon = '<i class="wi wi-night-partly-cloudy"></i>';
		}
		return {
			icon: icon,
			text: "Mostly Cloudy"
		};
	} else if (description == "1101") {
		if (day) {
			var icon = '<i class="wi wi-day-cloudy"></i>';
		} else {
			var icon = '<i class="wi wi-night-alt-partly-cloudy"></i>';
		}
		return {
			icon: icon,
			text: "Partly Cloudy"
		};
	} else if (description == "1100") {
		if (day) {
			var icon = '<i class="wi wi-day-cloudy"></i>';
		} else {
			var icon = '<i class="wi wi-night-alt-cloudy"></i>';
		}
		return {
			icon: icon,
			text: "Mostly Clear"
		};
	} else if (description == "1000") {
		if (day) {
			var icon = '<i class="wi wi-day-sunny"></i>';
		} else {
			var icon = '<i class="wi wi-night-clear"></i>';
		}
		return {
			icon: icon,
			text: "Clear"
		};
	}
}