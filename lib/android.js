/**
 * Detects the Android development environment and its dependencies.
 *
 * @module lib/android
 *
 * @copyright
 * Copyright (c) 2009-2014 by Appcelerator, Inc. All Rights Reserved.
 *
 * @license
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */

var fs = require('fs'),
	path = require('path'),
	crypto = require('crypto'),
	async = require('async'),
	appc = require('node-appc'),
	ADB = require('./adb'),
	manifestJson = appc.pkginfo.manifest(module),
	androidPackageJson = {},
	i18n = appc.i18n(__dirname),
	__ = i18n.__,
	__n = i18n.__n,
	afs = appc.fs,
	encoding = appc.encoding,
	run = appc.subprocess.run,
	findExecutable = appc.subprocess.findExecutable,
	getRealName = appc.subprocess.getRealName,
	exe = process.platform == 'win32' ? '.exe' : '',
	cmd = process.platform == 'win32' ? '.cmd' : '',
	bat = process.platform == 'win32' ? '.bat' : '',
	requiredSdkTools = {
		'adb': exe,
		'android': bat,
		'emulator': exe,
		'mksdcard': exe,
		'zipalign': exe,
		'aapt': exe,
		'aidl': exe,
		'dx': bat
	},
	envCache;

// need to find the android module and its package.json
(function findPackageJson(dir) {
	if (dir != '/') {
		var file = path.join(dir, 'android', 'package.json');
		if (fs.existsSync(file)) {
			androidPackageJson = require(file);
		} else {
			findPackageJson(path.dirname(dir));
		}
	}
}(path.join(__dirname, '..', '..', '..')));

/**
 * Detects current Android environment.
 * @param {Object} config - The CLI config object
 * @param {Object} opts - Detect options
 * @param {Boolean} [opts.bypassCache=false] - Bypasses the Android environment detection cache and re-queries the system
 * @param {Function} finished - Callback when detection is finished
 */
exports.detect = function detect(config, opts, finished) {
	opts || (opts = {});

	if (envCache && !opts.bypassCache) return finished(envCache);

	async.parallel({
		jdk: function (next) {
			appc.jdk.detect(config, opts, function (results) {
				next(null, results);
			});
		},

		sdk: function (next) {
			var queue = async.queue(function (task, callback) {
				task(function (err, result) {
					if (err) {
						callback(); // go to next item in the queue
					} else {
						next(null, result);
					}
				});
			}, 1);

			queue.drain = function () {
				// we have completely exhausted all search paths
				next(null, null);
			};

			queue.push([
				// first let's check the config's value
				function (cb) {
					findSDK(config.get('android.sdkPath'), config, androidPackageJson, cb);
				},
				// try the environment variables
				function (cb) {
					findSDK(process.env.ANDROID_SDK_ROOT, config, androidPackageJson, cb);
				},
				function (cb) {
					findSDK(process.env.ANDROID_SDK, config, androidPackageJson, cb);
				},
				// try finding the 'android' executable
				function (cb) {
					findExecutable([config.get('android.executables.android'), 'android' + bat], function (err, result) {
						if (err) {
							cb(err);
						} else {
							findSDK(path.resolve(result, '..', '..'), config, androidPackageJson, cb);
						}
					});
				},
				// try finding the 'adb' executable
				function (cb) {
					findExecutable([config.get('android.executables.adb'), 'adb' + exe], function (err, result) {
						if (err) {
							cb(err);
						} else {
							findSDK(path.resolve(result, '..', '..'), config, androidPackageJson, cb);
						}
					});
				}
			]);

			// scan various paths
			var dirs = process.platform == 'win32'
				? ['%SystemDrive%', '%ProgramFiles%', '%ProgramFiles(x86)%', '%CommonProgramFiles%', '~']
				: ['/opt', '/opt/local', '/usr', '/usr/local', '~'];

			dirs.forEach(function (dir) {
				dir = afs.resolvePath(dir);
				try {
					fs.existsSync(dir) && fs.readdirSync(dir).forEach(function (name) {
						var subdir = path.join(dir, name);
						if (/android/i.test(name) && fs.existsSync(subdir) && fs.statSync(subdir).isDirectory()) {
							queue.push(function (cb) {
								findSDK(subdir, config, androidPackageJson, cb);
							});

							// this dir may be the Android SDK, but just in case,
							// let's see if there's an Android folder in this one
							fs.statSync(subdir).isDirectory() && fs.readdirSync(subdir).forEach(function (name) {
								if (/android/i.test(name)) {
									queue.push(function (cb) {
										findSDK(path.join(subdir, name), config, androidPackageJson, cb);
									});
								}
							});
						}
					});
				} catch (e) {}
			});
		},

		ndk: function (next) {
			var queue = async.queue(function (task, callback) {
				task(function (err, result) {
					if (err) {
						callback(); // go to next item in the queue
					} else {
						next(null, result);
					}
				});
			}, 1);

			queue.drain = function () {
				// we have completely exhausted all search paths
				next(null, null);
			};

			queue.push([
				// first let's check the config's value
				function (cb) {
					findNDK(config.get('android.ndkPath'), config, cb);
				},
				// try the environment variable
				function (cb) {
					findNDK(process.env.ANDROID_NDK, config, cb);
				},
				// try finding the 'ndk-build' executable
				function (cb) {
					findExecutable([config.get('android.executables.ndkbuild'), 'ndk-build' + cmd], function (err, result) {
						if (err) {
							cb(err);
						} else {
							findNDK(path.dirname(result), config, cb);
						}
					});
				}
			]);

			// scan various paths
			var dirs = process.platform == 'win32'
				? ['%SystemDrive%', '%ProgramFiles%', '%ProgramFiles(x86)%', '%CommonProgramFiles%', '~']
				: ['/opt', '/opt/local', '/usr', '/usr/local', '~'];

			dirs.forEach(function (dir) {
				dir = afs.resolvePath(dir);
				try {
					fs.existsSync(dir) && fs.readdirSync(dir).forEach(function (name) {
						var subdir = path.join(dir, name);
						if (/android/i.test(name)) {
							queue.push(function (cb) {
								findSDK(subdir, config, androidPackageJson, cb);
							});
						}
					});
				} catch (e) {}
			});
		},

		linux64bit: function (next) {
			// detect if we're using a 64-bit Linux OS that's missing 32-bit libraries
			if (process.platform == 'linux' && process.arch == 'x64') {
				var result = {
					libGL: fs.existsSync('/usr/lib/libGL.so'),
					i386arch: null,
					'libc6:i386': null,
					'libncurses5:i386': null,
					'libstdc++6:i386': null,
					'zlib1g:i386': null,
					glibc: null,
					libstdcpp: null
				};
				async.parallel([
					function (cb) {
						findExecutable([config.get('linux.dpkg'), 'dpkg'], function (err, dpkg) {
							if (err || !dpkg) return cb();

							var archs = {};
							run(dpkg, '--print-architecture', function (code, stdout, stderr) {
								stdout.split('\n').forEach(function (line) {
									(line = line.trim()) && (archs[line] = 1);
								});
								run(dpkg, '--print-foreign-architectures', function (code, stdout, stderr) {
									stdout.split('\n').forEach(function (line) {
										(line = line.trim()) && (archs[line] = 1);
									});

									// now that we have the architectures, make sure we have the i386 architecture
									result.i386arch = !!archs.i386;
									cb();
								});
							});
						});
					},
					function (cb) {
						findExecutable([config.get('linux.dpkgquery'), 'dpkg-query'], function (err, dpkgquery) {
							if (err || !dpkgquery) return cb();

							async.each(
								['libc6:i386', 'libncurses5:i386', 'libstdc++6:i386', 'zlib1g:i386'],
								function (pkg, next) {
									run(dpkgquery, ['-l', pkg], function (code, out, err) {
										result[pkg] = false;
										if (!code) {
											var lines = out.split('\n'),
												i = 0,
												l = lines.length;
											for (; i < l; i++) {
												if (lines[i].indexOf(pkg) != -1) {
													// we look for "ii" which means we want the "desired action"
													// to be "installed" and the "status" to be "installed"
													if (lines[i].indexOf('ii') == 0) {
														result[pkg] = true;
													}
													break;
												}
											}
										}
										next();
									});
								},
								function () {
									cb();
								}
							);
						});
					},
					function (cb) {
						findExecutable([config.get('linux.rpm'), 'rpm'], function (err, rpm) {
							if (err || !rpm) return cb();

							run(rpm, '-qa', function (code, stdout, stderr) {
								stdout.split('\n').forEach(function (line) {
									if (/^glibc\-/.test(line)) {
										if (/\.i[36]86$/.test(line)) {
											result.glibc = true;
										} else if (result.glibc !== true) {
											result.glibc = false;
										}
									}
									if (/^libstdc\+\+\-/.test(line)) {
										if (/\.i[36]86$/.test(line)) {
											result.libstdcpp = true;
										} else if (result.libstdcpp !== true) {
											result.libstdcpp = false;
										}
									}
								});
								cb();
							});
						});
					}
				], function () {
					next(null, result);
				});
			} else {
				next(null, null);
			}
		}

	}, function (err, results) {
		var sdkHome = process.env.ANDROID_SDK_HOME && afs.resolvePath(process.env.ANDROID_SDK_HOME),
			jdkInfo = results.jdk;

		delete results.jdk;

		results.home               = sdkHome && fs.existsSync(sdkHome) && fs.statSync(sdkHome).isDirectory() ? sdkHome : afs.resolvePath('~/.android');
		results.detectVersion      = '2.0';
		results.vendorDependencies = androidPackageJson.vendorDependencies;
		results.targets            = {};
		results.avds               = [];
		results.issues             = [];

		function finalize() {
			finished(envCache = results);
		}

		if (!jdkInfo.home) {
			results.issues.push({
				id: 'ANDROID_JDK_NOT_FOUND',
				type: 'error',
				message: __('JDK (Java Development Kit) not found.') + '\n'
					+ __('If you already have installed the JDK, verify your __JAVA_HOME__ environment variable is correctly set.') + '\n'
					+ __('The JDK can be downloaded and installed from %s.', '__http://appcelerator.com/jdk__')
			});
			results.sdk = null;
			return finalize();
		}

		if (process.platform == 'win32' && jdkInfo.home.indexOf('&') != -1) {
			results.issues.push({
				id: 'ANDROID_JDK_PATH_CONTAINS_AMPERSANDS',
				type: 'error',
				message: __('The JDK (Java Development Kit) path must not contain ampersands (&) on Windows.') + '\n'
					+ __('Please move the JDK into a path without an ampersand and update the __JAVA_HOME__ environment variable.')
			});
			results.sdk = null;
			return finalize();
		}

		if (results.linux64bit !== null) {
			if (!results.linux64bit.libGL) {
				results.issues.push({
					id: 'ANDROID_MISSING_LIBGL',
					type: 'warning',
					message: __('Unable to locate an /usr/lib/libGL.so.') + '\n'
						+ __('Without the libGL library, the Android Emulator may not work properly.') + '\n'
						+ __('You may be able to fix it by reinstalling your graphics drivers and make sure it installs the 32-bit version.')
				});
			}

			if (results.linux64bit.i386arch === false) {
				results.issues.push({
					id: 'ANDROID_MISSING_I386_ARCH',
					type: 'warning',
					message: __('i386 architecture is not configured.') + '\n'
						+ __('To ensure you install the required 32-bit libraries, you need to register the i386 architecture with dpkg.') + '\n'
						+ __('To add the i386 architecture, run "%s".', '__sudo dpkg --add-architecture i386__')
				});
			}

			var missing32bitLibs = [];
			results.linux64bit['libc6:i386'] === false && missing32bitLibs.push('libc6:i386');
			results.linux64bit['libncurses5:i386'] === false && missing32bitLibs.push('libncurses5:i386');
			results.linux64bit['libstdc++6:i386'] === false && missing32bitLibs.push('libstdc++6:i386');
			results.linux64bit['zlib1g:i386'] === false && missing32bitLibs.push('zlib1g:i386');
			if (missing32bitLibs.length) {
				results.issues.push({
					id: 'ANDROID_MISSING_32BIT_LIBS',
					type: 'error',
					message: __('32-bit libraries is not installed.') + '\n'
						+ __('Without the 32-bit libraries, the Android SDK will not work properly.') + '\n'
						+ __('To install the required 32-bit libraries, run "%s".', '__sudo apt-get install ' + missing32bitLibs.join(' ') + '__')
				});
			}

			if (results.linux64bit.glibc === false) {
				results.issues.push({
					id: 'ANDROID_MISSING_32BIT_GLIBC',
					type: 'warning',
					message: __('32-bit glibc library is not installed.') + '\n'
						+ __('Without the 32-bit glibc library, the Android Emulator will not work properly.') + '\n'
						+ __('To install the required 32-bit glibc library, run "%s".', '__sudo yum install glibc.i686__')
				});
			}

			if (results.linux64bit.libstdcpp === false) {
				results.issues.push({
					id: 'ANDROID_MISSING_32BIT_LIBSTDCPP',
					type: 'warning',
					message: __('32-bit libstdc++ library is not installed.') + '\n'
						+ __('Without the 32-bit libstdc++ library, the Android Emulator will not work properly.') + '\n'
						+ __('To install the required 32-bit libstdc++ library, run "%s".', '__sudo yum install libstdc++.i686__')
				});
			}
		}

		if (!results.ndk) {
			results.issues.push({
				id: 'ANDROID_NDK_NOT_FOUND',
				type: 'warning',
				message: __('Unable to locate an Android NDK.') + '\n'
					+ __('Without the NDK, you will not be able to build native Android Titanium modules.') + '\n'
					+ __("If you have already downloaded and installed the Android NDK, you can tell Titanium where the Android NDK is located by running '%s', otherwise you can install it by running '%s' or manually downloading from %s.",
						'__titanium config android.ndkPath /path/to/android-ndk__',
						'__titanium setup android__',
						'__http://appcelerator.com/android-ndk__')
			});
		}

		// if we don't have an android sdk, then nothing else to do
		if (!results.sdk) {
			results.issues.push({
				id: 'ANDROID_SDK_NOT_FOUND',
				type: 'error',
				message: __('Unable to locate an Android SDK.') + '\n'
					+ __("If you have already downloaded and installed the Android SDK, you can tell Titanium where the Android SDK is located by running '%s', otherwise you can install it by running '%s' or manually downloading from %s.",
						'__titanium config android.sdkPath /path/to/android-sdk__',
						'__titanium setup android__',
						'__http://appcelerator.com/android-sdk__')
			});
			return finalize();
		}

		if (results.sdk.buildTools.tooNew === 'maybe') {
			results.issues.push({
				id: 'ANDROID_BUILD_TOOLS_TOO_NEW',
				type: 'warning',
				message: '\n' +__('Android Build Tools %s are too new and may or may not work with Titanium.', results.sdk.buildTools.version) + '\n' +
					__('If you encounter problems, select a supported version with:') + '\n' +
					'   __ti config android.buildTools.selectedVersion ##.##.##__' +
					__('\n where ##.##.## is a version in ') + results.sdk.buildTools.path.split('/').slice(0,-1).join('/') + __(' that is ') + results.sdk.buildTools.maxSupported.replace('<', '<=')
			});
		}

		// check if we're running Windows and if the sdk path contains ampersands
		if (process.platform == 'win32' && results.sdk.path.indexOf('&') != -1) {
			results.issues.push({
				id: 'ANDROID_SDK_PATH_CONTAINS_AMPERSANDS',
				type: 'error',
				message: __('The Android SDK path must not contain ampersands (&) on Windows.') + '\n'
					+ __('Please move the Android SDK into a path without an ampersand and re-run __titanium setup android__.')
			});
			results.sdk = null;
			return finalize();
		}

		// check if the sdk is missing any commands
		var missing = Object.keys(requiredSdkTools).filter(function (cmd) { return !results.sdk.executables[cmd]; });
		if (missing.length) {
			var dummyPath = path.join(path.resolve('/'), 'path', 'to', 'android-sdk'),
				msg = __n('Missing required Android SDK tool: %%s', 'Missing required Android SDK tools: %%s', missing.length, '__' + missing.join(', ') + '__') + '\n\n'
					+ __('The Android SDK located at %s has incomplete or out-of-date packages.', '__' + results.sdk.path + '__') + '\n\n'
					+ __('Current installed Android SDK tools:') + '\n'
					+ '  Android SDK Tools:          ' + (results.sdk.tools.version || 'not installed') + '\n'
					+ '  Android SDK Platform Tools: ' + (results.sdk.platformTools.version || 'not installed') + '\n'
					+ '  Android SDK Build Tools:    ' + (results.sdk.buildTools.version || 'not installed') + '\n\n'
					+ __('Make sure you have the latest Android SDK Tools, Platform Tools, and Build Tools installed.') + '\n\n'
					+ __('You can also specify the exact location of these required tools by running:') + '\n';

			missing.forEach(function (m) {
				msg += '  ti config android.executables.' + m + ' "' + path.join(dummyPath, m + requiredSdkTools[m]) + '"\n';
			});

			msg += '\n' + __('If you need to, run "%s" to reconfigure the Titanium Android settings.', 'titanium setup android');

			results.issues.push({
				id: 'ANDROID_SDK_MISSING_PROGRAMS',
				type: 'error',
				message: msg
			});
		}

		getRealName(results.sdk.executables.android, function (err, exe) {
			if (err) return finalize();

			run(exe, 'list', {
				cwd: afs.resolvePath('~'),
				env: appc.util.mix({}, process.env, { 'JAVA_HOME': jdkInfo.home })
			}, function (err, stdout, stderr) {
				if (err) return finalize();

				// create the list of target directories and their properties
				var addonsDir = path.join(results.sdk.path, 'add-ons'),
					addons = {},
					manifestNameRegex = /^(?:name|Addon\.Name(?:Display)?)=(.*)$/m,
					manifestVendorRegex = /^(?:vendor|Addon\.Vendor(?:Display)?)=(.*)$/m,
					manifestApiRegex = /^(?:api|AndroidVersion\.ApiLevel)=(.*)$/m,
					manifestRevisionRegex = /^(?:revision|Pkg.Revision)=(.*)$/m;

				fs.existsSync(addonsDir) && afs.visitDirsSync(addonsDir, function (subDir, subDirPath) {
					var file = path.join(subDirPath, 'manifest.ini');
					if (!fs.existsSync(file)) {
						file = path.join(subDirPath, 'source.properties');
					}
					if (fs.existsSync(file)) {
						var manifest = fs.readFileSync(file).toString(),
							name = manifest.match(manifestNameRegex),
							vendor = manifest.match(manifestVendorRegex),
							api = manifest.match(manifestApiRegex),
							revision = manifest.match(manifestRevisionRegex);
						name && vendor && api && revision && (addons[name[1] + '|' + vendor[1] + '|' + api[1] + '|' + revision[1]] = subDirPath);
					}
				});

				var sections = {},
					lastSection,
					sectionRegExp = /^\w.*\:$/;
				stdout.split('\n').forEach(function (line) {
					if (sectionRegExp.test(line)) {
						sections[line] || (sections[line] = []);
						lastSection = line;
					} else if (lastSection && line) {
						sections[lastSection].push(line);
					}
				});

				Object.keys(sections).forEach(function (name) {
					sections[name] = sections[name].join('\n').split(/\-\-\-\-\-\-+\n/);
				});

				// process the targets
				var apiLevelMap = {},
					sdkMap = {},

					targets = sections['Available Android targets:'],
					avds = sections['Available Android Virtual Devices:'],
					issues = sections['The following Android Virtual Devices could not be loaded:'],
					deviceDefs = sections['Available devices definitions:'],

					idRegex = /^id: ([^\s]+) or "(.+)"$/,
					libEntryRegex = /^\*\s+?(.+) \((.*)\)$/,
					basedOnRegex = /^Based on Android ([^\s]+) \(API level ([^)]+)\)$/,
					keyValRegex = /^\s*(.+)\: (.+)$/;

				targets && targets.forEach(function (target) {
					target.split('\n\w').forEach(function (chunk) {
						chunk = chunk.trim();
						if (!chunk) return;

						var lines = chunk.split('\n'),
							m = lines.shift().match(idRegex),
							info = m && (results.targets[m[1]] = { id: m[2], abis: [], skins: [] }),
							i, len, line, p, key, value;

						if (!m) return; // shouldn't happen

						for (i = 0, len = lines.length; i < len; i++) {
							line = lines[i].trim();
							if (line == 'Libraries:') {
								info.libraries || (info.libraries = {});
								for (++i; i < len; i++) {
									if (m = lines[i].trim().match(libEntryRegex)) {
										if (++i < len) {
											info.libraries[m[1]] = {
												jar: m[2],
												description: lines[i].trim()
											};
										} else {
											i--;
										}
									} else {
										i--;
										break;
									}
								}
							} else if (m = line.match(basedOnRegex)) {
								info['based-on'] = {
									'android-version': m[1],
									'api-level': ~~m[2]
								};
							} else {
								// simple key-value
								p = line.indexOf(':');
								if (p != -1) {
									key = line.substring(0, p).toLowerCase().trim().replace(/\s/g, '-');
									value = line.substring(p+1).trim();
									switch (key) {
										case 'abis':
										case 'skins':
											value.split(',').forEach(function (v) {
												v = v.replace('(default)', '').trim();
												if (info[key].indexOf(v) == -1) {
													info[key].push(v);
												}
											});
											break;
										case 'tag/abis':
											// note: introduced in android sdk tools 22.6
											value.split(',').forEach(function (v) {
												var p = v.indexOf('/');
												v = (p == -1 ? v : v.substring(p + 1)).trim();
												if (info.abis.indexOf(v) == -1) {
													info.abis.push(v);
												}
											});
											break;
										case 'type':
											info[key] = value.toLowerCase();
											break;
										default:
											var num = Number(value);
											if (value.indexOf('.') === -1 && !isNaN(num) && typeof num === 'number') {
												info[key] = Number(value);
											} else {
												info[key] = value;
											}
									}
								}
							}
						}

						if (info.type == 'platform') {
							var srcPropsFile = path.join(results.sdk.path, 'platforms', info.id, 'source.properties'),
								srcProps = fs.existsSync(srcPropsFile) ? fs.readFileSync(srcPropsFile).toString() : '';

							info.path = path.join(results.sdk.path, 'platforms', info.id);
							info.sdk = (function (m) { return m ? ~~m[1] : null; })(srcProps.match(/^AndroidVersion.ApiLevel=(.*)$/m));
							info.version = (function (m) { if (m) return m[1]; m = info.name.match(/Android (((\d\.)?\d\.)?\d)/); return m ? m[1] : null; })(srcProps.match(/^Platform.Version=(.*)$/m));
							info.androidJar = path.join(info.path, 'android.jar');
							info.supported = !~~info['api-level'] || appc.version.satisfies(info['api-level'], androidPackageJson.vendorDependencies['android sdk'], true);
							info.aidl = path.join(info.path, 'framework.aidl');
							fs.existsSync(info.aidl) || (info.aidl = null);

							apiLevelMap[info['api-level'] || info.id.replace('android-', '')] = info;
							sdkMap[info.version] = info;
						} else if (info.type == 'add-on' && info['based-on']) {
							info.path = addons[info.name + '|' + info.vendor + '|' + info['based-on']['api-level'] + '|' + info.revision] || null;
							info.version = info['based-on']['android-version'];
							info.androidJar = null;
							info.supported = !~~info['based-on']['api-level'] || appc.version.satisfies(info['based-on']['api-level'], androidPackageJson.vendorDependencies['android sdk'], true);
						}

						if (!info.supported) {
							results.issues.push({
								id: 'ANDROID_API_TOO_OLD',
								type: 'warning',
								message: __('Android API %s is too old and is no longer supported by Titanium SDK %s.', '__' + info.name + ' (' + info.id + ')__', manifestJson.version) + '\n' +
									__('The minimum supported Android API level by Titanium SDK %s is API level %s.', manifestJson.version, appc.version.parseMin(androidPackageJson.vendorDependencies['android sdk']))
							});
						} else if (info.supported == 'maybe') {
							results.issues.push({
								id: 'ANDROID_API_TOO_NEW',
								type: 'warning',
								message: __('Android API %s is too new and may or may not work with Titanium SDK %s.', '__' + info.name + ' (' + info.id + ')__', manifestJson.version) + '\n' +
									__('The maximum supported Android API level by Titanium SDK %s is API level %s.', manifestJson.version, appc.version.parseMax(androidPackageJson.vendorDependencies['android sdk']))
							});
						}
					});

					// try to find aidl files the add-ons
					Object.keys(results.targets).forEach(function (id) {
						var basedOn = results.targets[id]['based-on'];
						if (results.targets[id].type == 'add-on' && basedOn && apiLevelMap[basedOn['api-level']]) {
							results.targets[id].androidJar = apiLevelMap[basedOn['api-level']].androidJar;
							results.targets[id].aidl = apiLevelMap[basedOn['api-level']].aidl;
						}
					});
				});

				// check that we found at least one target
				if (!Object.keys(results.targets).length) {
					results.issues.push({
						id: 'ANDROID_NO_APIS',
						type: 'error',
						message: __('No Android APIs found.') + '\n' +
							__("Run '%s' to install the latest Android APIs.", '__' + results.sdk.executables.android + '__')
					});
				}

				// check that we found at least one valid target
				if (!Object.keys(results.targets).some(function (t) { return !!results.targets[t].supported; })) {
					results.issues.push({
						id: 'ANDROID_NO_VALID_APIS',
						type: 'warning',
						message: __('No valid Android APIs found that are supported by Titanium SDK %s.', manifestJson.version) + '\n' +
							__("Run '%s' to install the latest Android APIs.", '__' + results.sdk.executables.android + '__')
					});
				}

				// parse the avds
				avds && avds.forEach(function (avd) {
					if (avd = avd.trim()) {
						var lines = avd.split('\n'),
							info = {
								type: 'avd'
							},
							i, len, line, m, key;

						for (i = 0, len = lines.length; i < len; i++) {
							line = lines[i].trim();
							if (m = line.match(keyValRegex)) {
								key = m[1].toLowerCase().trim().replace(/\s/g, '-');
								if (key == 'tag/abi') {
									info['abi'] = m[2].replace(/^\w+\//, '');
								} else {
									info[key] = m[2];
								}
							} else if (m = line.match(basedOnRegex)) {
								info['based-on'] = {
									'android-version': m[1],
									'api-level': ~~m[2]
								};
							}
						}

						if (info.path && info.sdcard && !fs.existsSync(info.sdcard)) {
							var sdcardFile = path.join(info.path, 'sdcard.img');
							info.sdcard = fs.existsSync(sdcardFile) ? sdcardFile : null;
						}

						info.googleApis = /google/i.test(info.target);

						if (info['based-on'] && info['based-on']['android-version']) {
							info['sdk-version'] = info['based-on']['android-version'];
						} else if (info.target) {
							if (m = info.target.match(/^Android ([^\s]+)/)) {
								info['sdk-version'] = m[1];
							}
						}

						results.avds.push(info);
					}
				});

				issues && issues.forEach(function (issue) {
					var lines = issue.split('\n'),
						info = {},
						i, len, line, m, key;
					for (i = 0, len = lines.length; i < len; i++) {
						line = lines[i].trim();
						if (m = line.match(keyValRegex)) {
							info[m[1].toLowerCase().trim().replace(/\s/g, '-')] = m[2];
						}
					}
					if (info.name && info.error) {
						results.issues.push({
							id: 'ANDROID_INVALID_EMULATOR',
							type: 'warning',
							message: __('The Android emulator "%s" has a problem:', info.name) + '\n' + info.error
						});
					}
				});

				finalize();
			});
		});
	});
};

exports.findSDK = findSDK;

function findSDK(dir, config, androidPackageJson, callback) {
	if (!dir) return callback(true);

	dir = afs.resolvePath(dir);

	// check if the supplied directory exists and is actually a directory
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return callback(true);

	var dxJarPath = path.join(dir, 'platform-tools', 'lib', 'dx.jar'),
		proguardPath = path.join(dir, 'tools', 'proguard', 'lib', 'proguard.jar'),
		result = {
			path: dir,
			executables: {
				adb:      path.join(dir, 'platform-tools', 'adb' + exe),
				android:  path.join(dir, 'tools', 'android' + bat),
				emulator: path.join(dir, 'tools', 'emulator' + exe),
				mksdcard: path.join(dir, 'tools', 'mksdcard' + exe),
				zipalign: path.join(dir, 'tools', 'zipalign' + exe),
				// Android SDK Tools v21 and older puts aapt and aidl in the platform-tools dir.
				// For SDK Tools v22 and later, they live in the build-tools/<ver> directory.
				aapt:     path.join(dir, 'platform-tools', 'aapt' + exe),
				aidl:     path.join(dir, 'platform-tools', 'aidl' + exe),
				dx:       path.join(dir, 'platform-tools', 'dx' + bat)
			},
			dx: fs.existsSync(dxJarPath) ? dxJarPath : null,
			proguard: fs.existsSync(proguardPath) ? proguardPath : null,
			tools: {
				path: null,
				supported: null,
				version: null
			},
			platformTools: {
				path: null,
				supported: null,
				version: null
			},
			buildTools: {
				path: null,
				supported: null,
				version: null,
				tooNew: null,
				maxSupported: null
			}
		},
		tasks = {},
		buildToolsDir = path.join(dir, 'build-tools');

	/*
		Determine build tools version to use based on either config setting
		(android.buildTools.selectedVersion) or latest version
	*/
	if (fs.existsSync(buildToolsDir)) {
		var file,
			ver = config.get('android.buildTools.selectedVersion');
		if (!ver) {
			// No selected version, so find the newest, supported build tools version
			var files = fs.readdirSync(buildToolsDir).sort().reverse(),
				i=0,
				len = files.length,
				buildToolsSupported;
			for(; i < len; i++) {
				if (buildToolsSupported = appc.version.satisfies(files[i], androidPackageJson.vendorDependencies['android build tools'], true)) {
					ver = files[i];
					break;
				}
			}
		}
		if (ver) {
			// A selectedVersion specified or supported version has been found
			file = path.join(buildToolsDir, ver, 'source.properties');
			if (fs.existsSync(file) && fs.statSync(path.join(buildToolsDir, ver)).isDirectory()) {
				var m = fs.readFileSync(file).toString().match(/Pkg\.Revision\s*?\=\s*?([^\s]+)/);
				if (m) {
					result.buildTools = {
						path: path.join(buildToolsDir, ver),
						supported: appc.version.satisfies(m[1], androidPackageJson.vendorDependencies['android build tools'], true),
						version: m[1],
						tooNew: buildToolsSupported,
						maxSupported: appc.version.parseMax(androidPackageJson.vendorDependencies['android build tools'], true)
					};
					var file;
					fs.existsSync(file = path.join(buildToolsDir, ver, 'aapt' + exe)) && (result.executables.aapt = file);
					fs.existsSync(file = path.join(buildToolsDir, ver, 'aidl' + exe)) && (result.executables.aidl = file);
					fs.existsSync(file = path.join(buildToolsDir, ver, 'dx' + bat)) && (result.executables.dx = file);
					fs.existsSync(file = path.join(buildToolsDir, ver, 'lib', 'dx.jar')) && (result.dx = file);
					fs.existsSync(file = path.join(buildToolsDir, ver, 'zipalign' + exe)) && (result.executables.zipalign = file);
				}
			} else {
				// build tools don't exist at the given location
				result.buildTools = {
					path: path.join(buildToolsDir, ver),
					supported: false,
					version: ver
				};
			}
		}
	}

	// see if this sdk has all the executables we need
	Object.keys(requiredSdkTools).forEach(function (cmd) {
		tasks[cmd] = function (next) {
			findExecutable([
				config.get('android.executables.' + cmd),
				result.executables[cmd]
			], function (err, r) {
				next(null, !err && r ? r : null);
			});
		};
	});

	async.parallel(tasks, function (err, executables) {
		result.executables = executables;

		// check that we have all required sdk programs
		if (Object.keys(requiredSdkTools).every(function (cmd) { return !executables[cmd]; })) return callback(true);

		var file = path.join(dir, 'tools', 'source.properties');

		// check if this directory contains an android sdk
		if (!fs.existsSync(executables.adb) || !fs.existsSync(executables.android) || !fs.existsSync(file)) {
			return callback(true);
		}

		// looks like we found an android sdk, check what version
		if (fs.existsSync(file)) {
			var m = fs.readFileSync(file).toString().match(/Pkg\.Revision\s*?\=\s*?([^\s]+)/);
			if (m) {
				result.tools = {
					path: path.join(dir, 'tools'),
					supported: appc.version.satisfies(m[1], androidPackageJson.vendorDependencies['android tools'], true),
					version: m[1]
				};
			}
		}

		file = path.join(dir, 'platform-tools', 'source.properties');
		if (fs.existsSync(file)) {
			var m = fs.readFileSync(file).toString().match(/Pkg\.Revision\s*?\=\s*?([^\s]+)/);
			if (m) {
				result.platformTools = {
					path: path.join(dir, 'platform-tools'),
					supported: appc.version.satisfies(m[1], androidPackageJson.vendorDependencies['android platform tools'], true),
					version: m[1]
				};
			}
		}

		callback(null, result);
	});
}

function findNDK(dir, config, callback) {
	if (!dir) return callback(true);

	// check if the supplied directory exists and is actually a directory
	dir = afs.resolvePath(dir);

	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return callback(true);

	var releasetxt;
	fs.readdirSync(dir).forEach(function (file) {
		if (file.toLowerCase() == 'release.txt') {
			releasetxt = path.join(dir, file);
		}
	});

	if (!releasetxt || !fs.existsSync(releasetxt)) return callback(true);

	findExecutable([
		config.get('android.executables.ndkBuild'),
		path.join(dir, 'ndk-build' + cmd)
	], function (err, ndkBuild) {
		callback(err || !ndkBuild, {
			path: dir,
			executables: {
				ndkbuild: ndkBuild
			},
			version: fs.readFileSync(releasetxt).toString().split('\n').shift().trim()
		});
	});
}