var ti = require('../lib/titanium'),
	fs = require('fs'),
	path = require('path');

/*
(function () {
	var tiapp = new ti.tiappxml();

	console.log('\nCreating empty tiapp.xml');
	console.log('toString():')
	console.log(tiapp.toString());
	console.log('\nJSON:')
	console.log(tiapp.toString('json'));
	console.log('\nPretty JSON:')
	console.log(tiapp.toString('pretty-json'));
	console.log('\nXML:');
	console.log(tiapp.toString('xml'));
}());

(function () {
	var tiapp = new ti.tiappxml();

	tiapp.id = 'com.another.app';
	tiapp.name = 'Another App';
	tiapp.version = '2.0';
	tiapp['deployment-targets'] = { android: false, iphone: true, mobileweb: true };
	tiapp['sdk-version'] = '2.2.0';
	tiapp.properties = {
		prop1: 'value1',
		prop2: 'value2',
		prop3: 'value3',
		prop4: 'value4'
	};

	console.log('\nCreating empty tiapp.xml and adding new nodes');
	console.log('toString():')
	console.log(tiapp.toString());
	console.log('\nJSON:')
	console.log(tiapp.toString('json'));
	console.log('\nPretty JSON:')
	console.log(tiapp.toString('pretty-json'));
	console.log('\nXML:');
	console.log(tiapp.toString('xml'));
}());

(function () {
	var tiapp = new ti.tiappxml(path.dirname(module.filename) + '/resources/tiapp1.xml');

	console.log('\nReading tiapp1.xml');
	console.log('toString():')
	console.log(tiapp.toString());
	console.log('\nJSON:')
	console.log(tiapp.toString('json'));
	console.log('\nPretty JSON:')
	console.log(tiapp.toString('pretty-json'));
	console.log('\nXML:');
	console.log(tiapp.toString('xml'));
}());

(function () {
	var tiapp = new ti.tiappxml(path.dirname(module.filename) + '/resources/tiapp1.xml');

	tiapp.id = 'com.another.app';
	tiapp.name = 'Another App';
	tiapp.version = '2.0';
	tiapp['deployment-targets'] = { android: false, iphone: true, mobileweb: true };
	tiapp['sdk-version'] = '2.2.0';

	console.log('\nReading tiapp1.xml and modifying nodes');
	console.log('toString():')
	console.log(tiapp.toString());
	console.log('\nJSON:')
	console.log(tiapp.toString('json'));
	console.log('\nPretty JSON:')
	console.log(tiapp.toString('pretty-json'));
	console.log('\nXML:');
	console.log(tiapp.toString('xml'));
}());
*/

(function () {
	var tiapp = new ti.tiappxml(path.dirname(module.filename) + '/resources/tiapp2.xml');

	console.log('\nReading tiapp2.xml');
	console.log('toString():')
	console.log(tiapp.toString());
	console.log('\nJSON:')
	console.log(tiapp.toString('json'));
	console.log('\nPretty JSON:')
	console.log(tiapp.toString('pretty-json'));
	console.log('\nXML:');
	console.log(tiapp.toString('xml'));
}());

(function () {
	var tiapp = new ti.tiappxml(path.dirname(module.filename) + '/resources/tiapp4.xml');

	console.log('\nReading tiapp4.xml');
	console.log('\nApp Id:');
	console.log(tiapp.id); // Should equal ti.testapp
	console.log('\nWindows Id:');
	console.log(tiapp.windows.id); // Should equal com.windows.example
}());

/*
(function () {
	var tiapp = new ti.tiappxml(path.dirname(module.filename) + '/resources/tiapp3.xml');

	console.log('\nReading tiapp3.xml');
	console.log('toString():')
	console.log(tiapp.toString());
	console.log('\nJSON:')
	console.log(tiapp.toString('json'));
	console.log('\nPretty JSON:')
	console.log(tiapp.toString('pretty-json'));
	console.log('\nXML:');
	console.log(tiapp.toString('xml'));
	console.log('\Original:');
	console.log(fs.readFileSync(__dirname + '/resources/tiapp3.xml').toString());
}());
*/
