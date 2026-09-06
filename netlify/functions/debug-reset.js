const {json} = require('./_lib/tenant');
exports.handler = async () => json(403,{ok:false,message:'Minuten und Gespraechsansicht koennen nur in der Tawano Verwaltung zurueckgesetzt werden.'});
