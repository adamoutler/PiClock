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

//Express app
var express = require('express');
var bodyParser = require('body-parser')
const appl = express();
appl.use(bodyParser.json());
appl.use(express.static("public"));

//Logging
var winston = require('winston');
require('winston-daily-rotate-file');
const NODE_ENV = process.env.NODE_ENV;
const myFormat = winston.format.printf(info => {
	return `${info.timestamp} ${info.level}: ${info.message}`;
});


var transport = new (winston.transports.DailyRotateFile)({
	filename: 'PiClock-%DATE%.log',
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


//If we're not in production then log to the `console` with the format:
//`${info.level}: ${info.message} JSON.stringify({ ...rest }) `


if (NODE_ENV == 'development') {
	logger.add(new winston.transports.Console({
		format: winston.format.combine(
				winston.format.timestamp({
					format: 'YYYY-MM-DD hh:mm:ss A ZZ'
				}),
				winston.format.colorize({ all: true }),
				winston.format.simple(),
				myFormat
		),
		handleExceptions: true
	}));
}


//Handle uncaught handleExceptions
process.on('unhandledRejection', (reason, p) => {
	logger.error('Unhandled Rejection: ' + reason.stack);
	// application specific logging, throwing an error, or other logic here
});

//initialize default vars to store data about weather
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
//json to store timings for iterative loops
var timer={};
timer.cur=new Date(0);
timer.fore=new Date(0);
timer.alert=new Date(0);

cur.dt=0;
alerts.features =[];

if (settings.mode == "local" || settings.mode == "server") {
	// start server backend
	initLoop();

	appl.get("/current", (req,res) => {
		res.status(200).json(cur);
	});

	appl.get("/forecast", (req,res) => {
		res.status(200).json(forecasts);
	});

	appl.get("/alerts", (req,res) => {
		res.status(200).json(alerts);
	});

	appl.get("/coords", (req,res) => {
		var tz = geoTz(settings.lat, settings.lon);

		res.status(200).json({
			lat: settings.lat,
			lon: settings.lon,
			clock: settings.clock,
			gMapKey: settings.gMapKey,
			backgroundImg : settings.backgroundImg,
			imgFontColor : settings.imgFontColor,
			tz: tz,
			aerisID : settings.aerisID,
			aerisSecret : settings.aerisSecret
		})
	});

	appl.get("/store", (req,res) => {
		res.status(200).json(store);
	})

	appl.get('/', (req,res) => {
		res.sendFile(__dirname + '/public/index.html');
	})

	appl.listen(8081, () => logger.info('PiClock listening on port 8081 in server mode'))
}

if (settings.mode =="local") {
	settings.servIP = "http://127.0.0.1:8081"
}

if (settings.mode == "local" || settings.mode == "client") {

	// add methods to dim display
	appl.get("/day",(req,res) => {
		if (req.ip == '::ffff:127.0.0.1') {
			exec('sudo bash -c  "echo 255 > /sys/class/backlight/rpi_backlight/brightness"');
			nightMode = false;
			logger.info(req.ip + " toggle day mode : "+ nightMode);
		};
		res.status(200);
	});

	appl.get("/night", (req,res) => {
		if (req.ip == '::ffff:127.0.0.1') {
			exec('sudo bash -c  "echo 17 > /sys/class/backlight/rpi_backlight/brightness"');
			nightMode = true;
			logger.info(req.ip + " toggle night mode : "+ nightMode);
		}
		res.status(200);
	})

	// fire up the electron broswer.

	const electron = require('electron')
	const { app, BrowserWindow } = electron	
	let win

	app.on('ready', () => {
		const { width, height } = electron.screen.getPrimaryDisplay().workAreaSize
		win = new BrowserWindow({ 
			width, 
			height, 
			frame: false, 
			webPreferences: {nodeIntegration: false,
							webSecurity: false,
							allowRunningInsecureContent: true}
		})
		win.loadURL(settings.servIP)
	})

}

if (settings.mode == "client") {
	// start node app to listen for display dim event
	appl.listen(8081, () => logger.info('PiClock listening on port 8081 in client mode'))
}

function initLoop(){
	// move the provider selection and loop start here
	var now = new Date();
	logger.info("initLoop")
	getWgovGridP();
	setInterval(function() {
		mainLoop();
	}, 1000);
}

function mainLoop(){
	// recurring function to kick off async calls to the various providers
	var now = new Date();
	
	if (Math.abs(now - timer.cur) > (settings.currentConditionsInterval * 1000)) {
		logger.info("update cur provider " + settings.curProvider);
		timer.cur = now;
		if (settings.curProvider=="openweather"){
			currentOwObs();
		} else if (settings.curProvider=="climacell"){
			currentCcObs();
			
			var suntimes = new generateSunTimes();
			cur.sunrise = suntimes.sunrise.toString();
			cur.sunset = suntimes.sunset.toString();
		} else if (settings.curProvider=="nws"){
			wgCurrent(settings.wgStaID);
			
			var suntimes = new generateSunTimes();
			cur.sunrise = suntimes.sunrise.toString();
			cur.sunset = suntimes.sunset.toString();
		} else if (settings.curProvider=="weatherapi") {
			currentWaObs();
		} else if (settings.curProvider=="visualcrossing"){
			currentVcObs();
		}
	}
	if (Math.abs(now - timer.alert) > (60 * 1000)) {
		logger.info("update NWS alerts");
		timer.alert = now;
		wgAlerts();
	}

	if (Math.abs(now - timer.fore) > (settings.forecastInterval * 1000)) {
		logger.info("update forecast provider");
		
		moonPhase();
		timer.fore = now;
		wgForecast(settings.wgForecast);
	}
}

async function currentOwObs(){
	var url = 'http://api.openweathermap.org/data/2.5/weather?lat='+settings.lat+'&lon='+settings.lon+'&appid='+settings.owAppId+'&units=imperial'
	logger.info(url);

	var { body } = await getPromise({
		url: url,
		json: true,
		headers: {'User-Agent': 'piclockjs'}
	});
	parseOW(body);
	var colors = updateBackground(cur.tempF);
		cur.bg = colors.bg;
		cur.color = colors.color;
}

async function currentCcObs(){
	
	var url = 'https://api.tomorrow.io/v4/timelines?location=' + settings.lat + '%2C' + settings.lon + '&units=imperial&fields=temperature%2CtemperatureApparent%2Chumidity%2CwindSpeed%2CweatherCode%2CwindDirection%2CpressureSeaLevel&timesteps=current'
	logger.info(url);
	try {
		var { body } = await getPromise({
			url: url,
			json: true,
			headers: {'User-Agent': 'piclockjs',
				'apikey' : settings.ccAppId,
				'accept' : 'application/json'
			}
		});
		 body.data.timelines[0].intervals[0].values.startTime = body.data.timelines[0].intervals[0].startTime; //stuff the timestamp into the values
		parseCC(body.data.timelines[0].intervals[0].values);
	}
	catch(e) {
		logger.error(e);
		generateMoonPhase();
	}

	var colors = updateBackground(cur.tempF);
	cur.bg = colors.bg;
	cur.color = colors.color;
}

async function currentWaObs(){
	var url = 'http://api.weatherapi.com/v1/current.json?key='+settings.waAppId+'&q='+settings.lat+','+settings.lon+'&aqi=no';
	logger.info(url);
	try {
		var { body } = await getPromise({
			url: url,
			json: true,
			headers: {
				'User-Agent': 'piclockjs',
				'accept' : 'application/json'
			}
		});

		parseWA(body);
		var colors = updateBackground(cur.tempF);
		cur.bg = colors.bg;
		cur.color = colors.color;
	}

	catch(e) {
		logger.error(e);
	}
}

async function currentVcObs(){
	try {
		var url = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/"+settings.lat+"%2C"+settings.lon+"/today?unitGroup=us&key="+settings.vcAppId+"&include=current"
		logger.info(url);
		var { body } = await getPromise({
			url: url,
			json: true,
			headers: {'User-Agent': 'piclockjs',
				'accept' : 'application/json'
			}
		});
		parseVc(body.currentConditions);
		var colors = updateBackground(cur.tempF);
		cur.bg = colors.bg;
		cur.color = colors.color;
	}
	
	catch(e) {
		logger.error(e);
	}
}

async function moonPhase () {
	var url = 'https://api.usno.navy.mil/rstt/oneday?date=now&coords=' + settings.lat +',' + settings.lon;
	logger.info(url);
	try {
		var { body } = await getPromise({
			url: url,
			json: true,
			rejectUnauthorized: false,
			headers: {'User-Agent': 'piclockjs'}
		});
		parseMoonPhase(body);
	}
	catch(e) {
		logger.error(e);
		generateMoonPhase();
	}
}

async function getWgovGridP(){
	var url = 'https://api.weather.gov/points/' + settings.lat + ',' + settings.lon;
	logger.info(url);
	try {
		var { body } = await getPromise({
			url: url,
			json: true,
			headers: {'User-Agent': 'piclockjs'}
		});
		settings.wgForecast = (body.properties.forecast);	
	}
	catch(e) {
		logger.error(e);
		setTimeout(function(){
			logger.warn("retrying NWS gridpoint");
			getWgovGridP();
		}, 5000);
		return;
	}
	if (typeof body.properties === "undefined") {
		setTimeout(function(){
			logger.warn("retrying NWS gridpoint");
			getWgovGridP();
		}, 5000);
		logger.warn("failed to retrieve gridpoint");
		return;
	}
	var obsurl = body.properties.observationStations;
	logger.info(obsurl);
	
	try {
		var { body } = await getPromise({
			url: obsurl,
			json: true,
			headers: {'User-Agent': 'piclockjs'}
		});
		settings.wgStaID = body.features[0].properties.stationIdentifier;
		logger.info("got NWS weather station " + body.features[0].properties.stationIdentifier);
	}
	catch(e) {
		logger.error(e);
		await sleep (1000);
		logger.warn("retrying NWS gridpoint");
		getWgovGridP();
	}
}

async function getWgovObs(wgovObsSta){
	if (typeof wgovObsSta === 'undefined') {
		logger.warn("NWS observation gridpoint data not updated");
		return;
	}
	logger.info(wgovObsSta);
	try {
		var { body } = await getPromise({
			url: wgovObsSta,
			json: true,
			headers: {'User-Agent': 'piclockjs'}
		});
		wgCurrent(body.features[0].properties.stationIdentifier);
	}
	catch(e) {
		logger.error(e)
	}
}

async function wgForecast(url){
	var now = new Date();
	
    if (typeof url === 'undefined') {
    	logger.warn("forecast gridpoint data not updated");
		timer.fore = new Date(now - (settings.forecastInterval * 1000) + (60 * 1000));
		logger.warn("set next forecast poll to : " + Date(timer.fore));
		return;
    }
	logger.info(url);
	try {
		var { body } = await getPromise({
			url: url,
			json: true,
			headers: 	{
							'User-Agent': 'piclock, ' + settings.email,
				 			'Accept':	'application/geo+json',
				 			'Feature-Flags': Math.floor(Math.random() * 1000)
				 		}
		});
		//logger.warn(body);
		parseWgForecast(body);
	}
	catch(e) {
		logger.error(e);
		timer.fore = new Date(now - settings.forecastInterval * 1000 + 60 * 1000);
		logger.warn("set next forecast poll to : " + Date(timer.fore) + " current time stamp " + Date(now.getUTCMilliseconds()));
	}
}

async function wgAlerts(){
	var now = new Date();
	var url = "https://api.weather.gov/alerts/active?point=" + settings.lat + "," + settings.lon;
	logger.info(url);
	try {
		var { body } = await getPromise({
			url: url,
			json: true,
			headers: {'User-Agent': 'piclockjs'}
		});
		parseWgAlert(body);
	}
	catch(e) {
		logger.error(e);
		timer.alert = now;
		logger.warn("set next alert poll to : " + Date(timer.alert));
	}
}

async function wgCurrent(staId) {
	var now = new Date();
    if (typeof staId === 'undefined') {
    	logger.warn("current gridpoint data not updated");
		timer.cur = (now - settings.currentConditionsInterval * 1000) + (60 * 1000);
		logger.warn("set next current poll to : " + Date(timer.cur));
		return;
    }
    
	var url = "https://api.weather.gov/stations/"+staId+"/observations/latest";
	logger.info(url);

	try {
		var { body } = await getPromise({
			url: url,
			json: false,
			headers: {'User-Agent': 'piclockjs'}
		});
		parsewgCurrent(body);
		var colors = updateBackground(cur.tempF);
		cur.bg = colors.bg;
		cur.color = colors.color;
	}
	catch(e) {
		logger.error(e);
	}
}
function parseVc(body){
	var now = new Date();
	
	if (body.datetimeEpoch <= cur.dt)
	{
		var update = new Date(0);
		var current = new Date(0);

		update.setUTCSeconds(body.datetimeEpoch);
		current.setUTCSeconds(cur.dt);

		var diffMs = (now - update); // diff in MS
		var diffMins = Math.round(diffMs / 1000 / 60); // minutes

		var diffCur = (current - update);
		var diffCurMins = (diffCur / 1000 / 60);

		logger.warn('stale update detected with timestamp : ' + update + " behind current timestamp by : " + diffCurMins + " behind now by : "+ diffMins + " minutes");
		return;
	}
	cur.dt = body.datetimeEpoch;
	cur.tempF = Math.round(body.temp);
	cur.feelsLike = Math.round(body.feelslike);
	cur.pressure = body.pressure;
	cur.windSpeed = body.windspeed;
	cur.windDir = d2d(body.winddir);
	cur.humidity = body.humidity;
	cur.curDesc = body.conditions;
	
	//visualcrossing puts sun times in local TZ	
	var sun = generateSunTimes();
	cur.sunrise = sun.sunrise;
	cur.sunset = sun.sunset;

	cur.curIcon = vcIcon(body.conditions).icon;
	
	storeValues(cur.dt,cur.tempF,cur.pressure,cur.humidity);
}
function parseWA(body){
	var now = new Date();
	
	if (body.current.last_updated_epoch <= cur.dt)
	{
		var update = new Date(0);
		var current = new Date(0);

		update.setUTCSeconds(body.current.last_updated_epoch);
		current.setUTCSeconds(cur.dt);

		var diffMs = (now - update); // diff in MS
		var diffMins = Math.round(diffMs / 1000 / 60); // minutes

		var diffCur = (current - update);
		var diffCurMins = (diffCur / 1000 / 60);

		logger.warn('stale update detected with timestamp : ' + update + " behind current timestamp by : " + diffCurMins + " behind now by : "+ diffMins + " minutes");
		return;
	}
	cur.dt = body.current.last_updated_epoch;
	
	cur.tempF = Math.round(body.current.temp_f);
	cur.feelsLike = Math.round(body.current.feelslike_f);
	cur.curDesc= body.current.condition.text;
	cur.curIcon = '<img id="curImg" src="http:'+ body.current.condition.icon +'"></img>'; 
	cur.pressure = body.current.pressure_mb;
	cur.windSpeed = body.current.wind_mph;
	cur.windDir = d2d(body.current.wind_degree);
	cur.humidity = body.current.humidity;
	
	var sun = generateSunTimes();
	cur.sunrise = sun.sunrise;
	cur.sunset = sun.sunset;

	storeValues(cur.dt,cur.tempF,cur.pressure,cur.humidity);
}

function parseOW(observation){
	var now = new Date();

	if (observation.dt <= cur.dt)
	{
		var update = new Date(0);
		var current = new Date(0);

		update.setUTCSeconds(observation.dt);
		current.setUTCSeconds(cur.dt);

		var diffMs = (now - update); // diff in MS
		var diffMins = Math.round(diffMs / 1000 / 60); // minutes

		var diffCur = (current - update);
		var diffCurMins = (diffCur / 1000 / 60);

		logger.warn('stale update detected with timestamp : ' + update + " behind current timestamp by : " + diffCurMins + " behind now by : "+ diffMins + " minutes");
		return;
	}

	var sunriseEpoch = new Date(0);
	var sunsetEpoch = new Date(0);


	sunriseEpoch.setUTCSeconds(observation.sys.sunrise);
	sunsetEpoch.setUTCSeconds(observation.sys.sunset);

	if ((now > sunsetEpoch ) || (now < sunriseEpoch)) {
		cur.curIcon = '<i class="wi wi-owm-night-' + observation.weather[0].id +'"></i>';
	} else {
		cur.curIcon = '<i class="wi wi-owm-day-' + observation.weather[0].id +'"></i>';
	}

	cur.tempF = Math.round(parseFloat(observation.main.temp));
	cur.feelsLike = Math.round(parseFloat(observation.main.feels_like));
	cur.pressure = observation.main.pressure;
	cur.humidity = observation.main.humidity;
	cur.windSpeed = observation.wind.speed;
	cur.windDir = d2d(observation.wind.deg);
	cur.curDesc = observation.weather[0].main;
	cur.sunrise = sunriseEpoch.toString();
	cur.sunset = sunsetEpoch.toString();
	cur.dt = observation.dt;

	storeValues(cur.dt,cur.tempF,cur.pressure,cur.humidity);
}

function parseMoonPhase(observation) {
	cur.moonPhase = observation.closestphase.phase;
	if (typeof observation.curphase != "undefined") {
		cur.moonPhase = observation.curphase;  // use more accurate phase
		// string
	}
}

function generateMoonPhase() {
	var timeAndDate = new Date();
	var phase = SunCalc.getMoonIllumination(timeAndDate).phase;
	logger.warn('generated moon phase with suncalc at '+phase);

	if (phase == 0)	{
		cur.moonPhase = "New Moon";
	} else if (phase >0 && phase <.23) {
		cur.moonPhase ="Waxing Crescent";
	} else if (phase >=.23 && phase <=.27) {
		cur.moonPhase ="First Quarter";
	} else if (phase >.27 && phase<.48) {
		cur.moonPhase = "Waxing Gibbous";
	} else if (phase >=.48 && phase <=.52) {
		cur.moonPhase ="Full Moon";
	} else if (phase>.52 && phase < .73) {
		cur.moonPhase = "Waning Gibbous";
	} else if (phase>=.73 && phase <=.77) {
		cur.moonPhase ="Last Quarter";
	} else if (phase>.77) {
		cur.moonPhase ="Waning Crescent";
	} else {
		cur.moonPhase = "error calculating phase";
	}
}

function generateSunTimes(){
	var now = new Date();
	var suncalcTimes = SunCalc.getTimes(now, settings.lat, settings.lon);
	return {
		sunrise : suncalcTimes.sunrise,
		sunset : suncalcTimes.sunset
	}
}

function parseWgForecast(data) {
	// usg forecast has a tendancy to mess up now()
	var now = new Date();
	var array = [];
	var fcount =0;
	
	for (var i =0; i < data.properties.periods.length - 1; i++) {
		var end = new Date(data.properties.periods[i].endTime);
		if ( end > now ){
			var forecast ={};  // temp object to build json	
			forecast.name = data.properties.periods[i].name;
			forecast.temp = data.properties.periods[i].temperature;
			forecast.short = data.properties.periods[i].shortForecast;
			forecast.icon = data.properties.periods[i].icon;
			forecast.detailed = data.properties.periods[i].detailedForecast;
			array.push(forecast);
			fcount++;
		} else {
			logger.warn("WG forecast date mismatch detected : " + end);	
			//logger.warn(data.properties.periods[i]);
		}
	}
	if (fcount >= 9){
		forecasts.list = array;
	} else {
		timer.fore = new Date(now - settings.forecastInterval * 1000 + 60 * 1000);
		logger.warn("set forecast poll to : " + Date(timer.fore) + " current time stamp " + Date(now.getUTCMilliseconds()));
	}
}

function parseWgAlert(data) {
	var array = [];
	for (var i =0; i < data.features.length; i++) {
		var alert ={};

		if (data.features[i].properties.event == "Special Weather Statement") {
			alert.headline = data.features[i].properties.parameters.NWSheadline[0];
		} else if (data.features[i].properties.event == "Winter Weather Advisory") {
			// myRegex = /.*/g;
			myRegex = /\* WHAT\.*([\s\S]*)\* WHERE[\s\S]*\* WHEN\.*([\s\S]*)\*/g;
			// myRegex = /WHAT([\s\S]*)/g;
			str = data.features[i].properties.description;
			try{
				match = myRegex.exec(str);
				alert.headline = match[1]+match[2];
			} catch(e) {
				console.log(e.message);
			}
		} else {
			alert.headline = data.features[i].properties.headline;
		}
		
		if (!alert.headline) {
			alert.headline=data.features[i].properties.headline;
		}
		
		// alert.areaDesc = data.features[i].properties.areaDesc;
		alert.severity = data.features[i].properties.severity;
		alert.description = data.features[i].properties.description;
		alert.id = data.features[i].properties.id;
		array.push(alert);
	}
	alerts.features = array;
}

function parsewgCurrent(data) {
	body = JSON.parse(data);
	observation = body.properties;
	
	obsdt = new Date(observation.timestamp).getTime() / 1000;
	var now = new Date();
	
	//logger.info(observation);
	
	if (obsdt <= cur.dt)
	{
		var update = new Date(0);
		var current = new Date(0);

		update.setUTCSeconds(obsdt);
		current.setUTCSeconds(cur.dt);

		var diffMs = (now - update); // diff in MS
		var diffMins = Math.round(diffMs / 1000 / 60); // minutes

		var diffCur = (current - update);
		var diffCurMins = (diffCur / 1000 / 60);

		logger.warn('stale update detected with timestamp : ' + update + " behind current timestamp by : " + diffCurMins + " behind now by : "+ diffMins + " minutes");
		return;
	} 
	
	if (!observation.temperature.value) {
		//KJYO 111915Z AUTO 20012KT 10SM CLR 26/05 A3015 RMK AO2 : null
		var metar = observation.rawMessage.toString();
		var temp = metar.match(/(\d{2})\//);
		logger.warn('fallback to METAR reading : ' + temp[1]);
		var tempC=parseFloat(temp[1]);	
		cur.tempF = Math.round(parseFloat((tempC * 9/5) + 32));
	} else {
		logger.info("using temp value : " + observation.temperature.value);
		cur.tempF = Math.round(parseFloat((observation.temperature.value * 9/5) + 32));	
	}

	cur.curDesc = observation.textDescription;
	cur.curIcon = '<img id="curImg" src="'+ observation.icon +'&size=small"></img>';
	
	cur.feelsLike = null;

	if (observation.windChill.value) {
		cur.feelsLike = Math.round(parseFloat((observation.windChill.value * 9/5) + 32));
	}

	if (observation.heatIndex.value) {
		cur.feelsLike = Math.round(parseFloat((observation.heatIndex.value * 9/5) + 32));
	}

	cur.pressure = Math.round(parseFloat(observation.barometricPressure.value / 100));
	cur.humidity = Math.round(parseFloat(observation.relativeHumidity.value));
	cur.windSpeed = Math.round(parseFloat(observation.windSpeed.value / 1.609));
	cur.windDir = d2d(observation.windDirection.value)
	cur.dt = new Date(observation.timestamp).getTime() / 1000;
	
	storeValues(cur.dt,cur.tempF,cur.pressure,cur.humidity);
}

function parseCC(body){
	var now = new Date();
	var update = new Date(body.startTime);
	
	if (update <= cur.dt)
	{
		var current = new Date(0);
		current.setUTCSeconds(cur.dt);

		var diffMs = (now - update); // diff in MS
		var diffMins = Math.round(diffMs / 1000 / 60); // minutes

		var diffCur = (current - update);
		var diffCurMins = (diffCur / 1000 / 60);

		logger.warn('stale update detected with timestamp : ' + update + " behind current timestamp by : " + diffCurMins + " behind now by : "+ diffMins + " minutes");
		return;
	}

	var desc=ccIcon(body.weatherCode);

	cur.curDesc = desc.text;
	cur.curIcon = desc.icon;
	
	cur.tempF = Math.round(parseFloat(body.temperature));
	cur.pressure = Math.round(parseFloat(body.pressureSeaLevel * 33.864));
	cur.humidity = Math.round(parseFloat(body.humidity));
	cur.windSpeed = body.windSpeed;
	cur.windDir = d2d(body.windDirection);
	cur.dt = update.getTime() / 1000;
	cur.feelsLike = Math.round(parseFloat(body.temperatureApparent));

	storeValues(cur.dt,cur.tempF,cur.pressure,cur.humidity);

}

function vcIcon(description){

	var now = new Date();
	var sunrise = new Date(cur.sunrise);
	var sunset = new Date(cur.sunset);

	var day;

	if (now > sunrise && now < sunset) {
		day = true;
	} else {
		day = false;
	}
	
	if (description == "Clear"){
		if (day) {
			var icon = '<i class="wi wi-day-sunny"></i>';
		} else {
			var icon = '<i class="wi wi-night-clear"></i>';
		}
	} else if (description =='Blowing Or Drifting Snow'){
		if (day) {
			var icon = '<i class="wi wi-day-snow-wind"></i>';
		} else {
			var icon = '<i class="wi wi-night-alt-snow-wind"></i>';
		}
	} else if ((description =='Drizzle')||(description =='Rain, Partially cloudy')){
		if (day) {
			var icon = '<i class="wi wi-day-sprinkle"></i>';
		} else {
			var icon = '<i class="wi wi-night-sprinkle"></i>';
		}
	} else if (description =='Heavy Drizzle'){
		if (day) {
			var icon = '<i class="wi wi-day-sprinkle"></i>';
		} else {
			var icon = '<i class="wi wi-night-sprinkle"></i>';
		}
	} else if (description =='Light Drizzle'){
		if (day) {
			var icon = '<i class="wi wi-day-sprinkle"></i>';
		} else {
			var icon = '<i class="wi wi-night-sprinkle"></i>';
		}
	} else if (description =='Heavy Drizzle/Rain'){
		if (day) {
			var icon = '<i class="wi wi-day-sprinkle"></i>';
		} else {
			var icon = '<i class="wi wi-night-sprinkle"></i>';
		}
	} else if (description =='Light Drizzle/Rain'){
		if (day) {
			var icon = '<i class="wi wi-day-sprinkle"></i>';
		} else {
			var icon = '<i class="wi wi-night-sprinkle"></i>';
		}
	} else if (description =='Duststorm'){
		if (day) {
			var icon = '<i class="wi wi-dust"></i>';
		} else {
			var icon = '<i class="wi wi-dust"></i>';
		}
	} else if (description =='Fog'){
		if (day) {
			var icon = '<i class="wi wi-day-fog"></i>';
		} else {
			var icon = '<i class="wi wi-night-fog"></i>';
		}
	} else if (description =='Freezing Drizzle/Freezing Rain'){
		if (day) {
			var icon = '<i class="wi wi-day-sleet"></i>';
		} else {
			var icon = '<i class="wi wi-night-sleet"></i>';
		}
	} else if (description =='Heavy Freezing Drizzle/Freezing Rain'){
		if (day) {
			var icon = '<i class="wi wi-day-sleet"></i>';
		} else {
			var icon = '<i class="wi wi-night-sleet"></i>';
		}
	} else if (description =='Light Freezing Drizzle/Freezing Rain'){
		if (day) {
			var icon = '<i class="wi wi-day-sleet"></i>';
		} else {
			var icon = '<i class="wi wi-night-sleet"></i>';
		}
	} else if (description =='Freezing Fog'){
		if (day) {
			var icon = '<i class="wi wi-fog"></i>';
		} else {
			var icon = '<i class="wi wi-fog"></i>';
		}
	} else if (description =='Heavy Freezing Rain'){
		if (day) {
			var icon = '<i class="wi wi-sleet"></i>';
		} else {
			var icon = '<i class="wi wi-sleet"></i>';
		}
	} else if (description =='Light Freezing Rain'){
		if (day) {
			var icon = '<i class="wi wi-sleet"></i>';
		} else {
			var icon = '<i class="wi wi-sleet"></i>';
		}
	} else if (description =='Funnel Cloud/Tornado'){
		if (day) {
			var icon = '<i class="wi wi-tornado"></i>';
		} else {
			var icon = '<i class="wi wi-tornado"></i>';
		}
	} else if (description =='Hail Showers'){
		if (day) {
			var icon = '<i class="wi wi-day-hail"></i>';
		} else {
			var icon = '<i class="wi wi-night-alt-hail"></i>';
		}
	} else if (description =='Ice'){
		if (day) {
			var icon = '<i class="wi wi-sleet"></i>';
		} else {
			var icon = '<i class="wi wi-sleet"></i>';
		}
	} else if (description =='Lightning Without Thunder'){
		if (day) {
			var icon = '<i class="wi wi-lightning"></i>';
		} else {
			var icon = '<i class="wi wi-lightning"></i>';
		}
	} else if (description =='Mist'){
		if (day) {
			var icon = '<i class="wi wi-raindrops"></i>';
		} else {
			var icon = '<i class="wi wi-raindrops"></i>';
		}
	} else if (description =='Precipitation In Vicinity'){
		if (day) {
			var icon = '<i class="wi wi-raindrop"></i>';
		} else {
			var icon = '<i class="wi wi-raindrop"></i>';
		}
	} else if (description =='Rain'){
		if (day) {
			var icon = '<i class="wi wi-day-rain"></i>';
		} else {
			var icon = '<i class="wi wi-night-rain"></i>';
		}
	} else if (description =='Heavy Rain And Snow'){
		if (day) {
			var icon = '<i class="wi wi-day-rain-mix"></i>';
		} else {
			var icon = '<i class="wi wi-night-rain-mix"></i>';
		}
	} else if (description =='Light Rain And Snow'){
		if (day) {
			var icon = '<i class="wi wi-day-rain-mix"></i>';
		} else {
			var icon = '<i class="wi wi-night-rain-mix"></i>';
		}
	} else if (description =='Rain Showers'){
		if (day) {
			var icon = '<i class="wi wi-day-rain"></i>';
		} else {
			var icon = '<i class="wi wi-night-rain"></i>';
		}
	} else if (description =='Heavy Rain'){
		if (day) {
			var icon = '<i class="wi wi-day-rain"></i>';
		} else {
			var icon = '<i class="wi wi-night-rain"></i>';
		}
	} else if (description =='Light Rain'){
		if (day) {
			var icon = '<i class="wi wi-day-rain"></i>';
		} else {
			var icon = '<i class="wi wi-night-rain"></i>';
		}
	} else if (description =='Sky Coverage Decreasing'){
		if (day) {
			var icon = '<i class="wi wi-cloud-down"></i>';
		} else {
			var icon = '<i class="wi wi-cloud-down"></i>';
		}
	} else if (description =='Sky Coverage Increasing'){
		if (day) {
			var icon = '<i class="wi wi-cloud-up"></i>';
		} else {
			var icon = '<i class="wi wi-cloud-up"></i>';
		}
	} else if (description =='Sky Unchanged'){
		if (day) {
			var icon = '<i class="wi wi-day-cloudy"></i>';
		} else {
			var icon = '<i class="wi wi-night-partly-cloudy"></i>';
		}
	} else if (description =='Smoke Or Haze'){
		if (day) {
			var icon = '<i class="wi wi-day-haze"></i>';
		} else {
			var icon = '<i class="wi wi-day-haze"></i>';
		}
	} else if (description =='Snow'){
		if (day) {
			var icon = '<i class="wi wi-day-snow"></i>';
		} else {
			var icon = '<i class="wi wi-night-snow"></i>';
		}
	} else if (description =='Snow And Rain Showers'){
		if (day) {
			var icon = '<i class="wi wi-day-rain-mix"></i>';
		} else {
			var icon = '<i class="wi wi-night-alt-rain-mix"></i>';
		}
	} else if (description =='Snow Showers'){
		if (day) {
			var icon = '<i class="wi wi-day-snow"></i>';
		} else {
			var icon = '<i class="wi wi-night-snow-wind"></i>';
		}
	} else if (description =='Heavy Snow'){
		if (day) {
			var icon = '<i class="wi wi-day-snow"></i>';
		} else {
			var icon = '<i class="wi wi-night-snow-wind"></i>';
		}
	} else if (description =='Light Snow'){
		if (day) {
			var icon = '<i class="wi wi-day-snow"></i>';
		} else {
			var icon = '<i class="wi wi-night-snow-wind"></i>';
		}
	} else if (description =='Squalls'){
		if (day) {
			var icon = '<i class="wi wi-day-windy"></i>';
		} else {
			var icon = '<i class="wi wi-night-windy"></i>';
		}
	} else if (description =='Thunderstorm'){
		if (day) {
			var icon = '<i class="wi wi-day-thunderstorm"></i>';
		} else {
			var icon = '<i class="wi wi-night-thunderstorm"></i>';
		}
	} else if (description =='Thunderstorm Without Precipitation'){
		if (day) {
			var icon = '<i class="wi wi-lightning"></i>';
		} else {
			var icon = '<i class="wi wi-lightning"></i>';
		}
	} else if (description =='Diamond Dust'){
		if (day) {
			var icon = '<i class="wi wi-stars"></i>';
		} else {
			var icon = '<i class="wi wi-stars"></i>';
		}
	} else if (description =='Hail'){
		if (day) {
			var icon = '<i class="wi wi-day-hail"></i>';
		} else {
			var icon = '<i class="wi wi-night-hail"></i>';
		}
	} else if (description =='Overcast'){
		if (day) {
			var icon = '<i class="wi wi-day-cloudy"></i>';
		} else {
			var icon = '<i class="wi wi-night-cloudy"></i>';
		}
	} else if (description =='Partially cloudy'){
		if (day) {
			var icon = '<i class="wi wi-day-cloudy-high"></i>';
		} else {
			var icon = '<i class="wi wi-night-partly-cloudy"></i>';
		}
	} else {
		icon = description;
	}
	return {
		icon : icon
	}
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

function ccMoon(phase) {
	if (phase=="new") {
		var txt = 'New Moon';
		var icon = '<i class="wi wi-moon-new"></i>';
	} else if (phase=="waxing_crescent") {
		var txt = 'Waxing Crescent';
		var icon = '<i class="wi wi-moon-waxing-crescent-1"></i>';
	} else if (phase=="waning_crescent") {
		var txt = 'Waning Crescent';
		var icon = '<i class="wi wi-moon-waning-crescent-1"></i>';
	} else if (phase=="first_quarter") {
		var txt = 'First Quarter';
		var icon = '<i class="wi wi-moon-first-quarter"></i>';
	} else if (phase=="last_quarter") {
		var txt = 'Last Quarter';
		var icon = '<i class="wi wi-moon-third-quarter"></i>';		
	} else if (phase=="waxing_gibbous") {
		var txt = 'Waxing Gibbous';
		var icon = '<i class="wi wi-moon-waxing-gibbous-1"></i>';
	} else if (phase=="waning_gibbous") {
		var txt = 'Waning Gibbous';
		var icon = '<i class="wi wi-moon-waning-gibbous-1"></i>';
	} else if (phase=="full") {
		var txt = 'Full Moon';
		var icon = '<i class="wi wi-moon-full"></i>';
	} else {
		var txt = phase;
	}
	return {
		icon: icon,
		text: txt
	};
}

//change background color based on temp
function updateBackground(temp) {
	var bg;
	var color;
	
	if (temp < 30 ){
		bg = "#94b7cf";
		color = "#fce8dd";
	} else if (temp>=90) {
		bg = "#E91E24";
		color = "#ffffff";
	} else if (temp>=30 && temp<40){
		bg = "#00A4E8";
		color = "#ffe3df";
	} else if (temp>=40 && temp<50){
		bg = "#2D3389";
		color = "#ffe3cc";
	} else if(temp>=50 && temp<60){
		bg = "#128A43";
		color = "#8a1e12";
	} else if (temp>=60 && temp<70){
		bg = "#76BD43";
		color = "#002B49";
	}else if (temp>=70 && temp<80){
		bg = "#FBD905";
		color = '#002B49';
	} else if (temp>=80 && temp<90){
		bg = "#F58322";
		color = '#002B49';
	}
	
	if (settings.imgFontColor){
		color = settings.imgFontColor;
	}
	
	return {
	 bg: bg,
	 color: color
	}
}


function storeValues(timestamp,temp,pressure,humidity) {
	obsdt = new Date( timestamp * 1000 );
	var oldest = new Date();
	if ( store.timestamp.length > 0 ){ 
		oldest = new Date(store.timestamp[0] * 1000);
	} else {
		oldest = obsdt;
	}
	var diff = Math.abs(obsdt-oldest);
	var diffInHours = diff/1000/60/60; // Convert milliseconds to hours/
	
	if ( diffInHours > 48 ) {
		logger.info('shifting store array');
		store.timestamp.shift();
		store.temp.shift();
		store.pressure.shift();
		store.humidity.shift();
	}

	store.timestamp.push(timestamp);
	store.temp.push(temp);
	store.pressure.push(pressure);
	store.humidity.push(humidity);

	cur.pressureTrend = trend(store.pressure,{lastpoints:5,avgPoints:60});
}
