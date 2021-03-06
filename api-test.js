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
var DOMParser = require('xmldom').DOMParser;
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

setInterval(function() {
		currentDsObs();
		currentOwObs();
		currentCcObs();
		currentWgovObs();
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
	var url = 'https://api.climacell.co/v3/weather/realtime?lat=' + settings.lat + '&lon=' + settings.lon + '&unit_system=us&fields=temp%2Cfeels_like%2Chumidity%2Cwind_speed%2Cmoon_phase%2Cweather_code%2Csunrise%2Csunset%2Cwind_direction%2Cbaro_pressure'
		
	var { body } = await getPromise({
		url: url,
		json: true,
		headers: {'User-Agent': 'piclockjs',
			'apikey' : settings.ccAppId,
			'accept' : 'application/json'
		}
	});
	parseCC(body);
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
	
	var now = new Date();
	var update = new Date(body.observation_time.value);
	
	var diffMs = (now - update); // diff in MS
	var diffMins = Math.round(diffMs / 1000 / 60); // minutes
	
	logger.info('climacell : ' + body.temp.value + " : " + diffMins + ' : ' + body.weather_code.value);
	//logger.info(body);
}

function parseWgov(body){
	observation = body.features[0].properties;
	
	var now = new Date();
	update = new Date(observation.timestamp);
	
	var diffMs = (now - update); // diff in MS
	var diffMins = Math.round(diffMs / 1000 / 60); // minutes
	
	var temp_f = observation.temperature.value * 1.8 + 32;
	
	logger.info('usg : ' + temp_f + " : " + diffMins);
}