const jsf = require('json-schema-faker');
const moment = require('moment');
const fs = require('fs');
const path = require('path');

// Number of records to generate
const numberOfRecords = 10; // Change this to generate more or fewer records

// Construct the path to the schema file
const schemaPath = path.join(__dirname, '..', 'schemas', 'schema.json');

// Read the schema from the file
let schema;
try {
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    schema = JSON.parse(schemaContent);
} catch (error) {
    console.error('Error reading or parsing the schema file:', error);
    process.exit(1);
}

// Load the locations
const locationsPath = path.join(__dirname, '..', 'data', 'locations.json');
let locations;
try {
    const locationsContent = fs.readFileSync(locationsPath, 'utf8');
    locations = JSON.parse(locationsContent).locations;
} catch (error) {
    console.error('Error reading or parsing the locations file:', error);
    process.exit(1);
}

// Create an array of location names
const locationNames = locations.map(item => item.name);

// Custom generator for locations
jsf.define('location', function() {
    return this.random.pickone(locationNames);
});

// Global context for time generation
let timeContext = {};

// Custom format for generating session start time
jsf.format('session-start-time', function() {
    const startTime = moment().subtract(Math.floor(Math.random() * 365) + 1, 'days').toISOString();
    timeContext.startTime = startTime;
    return startTime;
});

// Custom format for generating session end time
jsf.format('session-end-time', function() {
    if (!timeContext.startTime) {
        throw new Error('start_time must be generated before end_time');
    }
    const start = moment(timeContext.startTime);
    const endTime = start.add(Math.floor(Math.random() * 180) + 30, 'minutes').toISOString();
    timeContext.endTime = endTime;
    return endTime;
});

// Custom format for generating activity timestamp
jsf.format('activity-time', function() {
    if (!timeContext.startTime || !timeContext.endTime) {
        throw new Error('start_time and end_time must be generated before activity timestamps');
    }
    const start = moment(timeContext.startTime);
    const end = moment(timeContext.endTime);
    return moment(start.valueOf() + Math.random() * (end.valueOf() - start.valueOf())).toISOString();
});

// Recursive function to modify schema and apply custom formats
const modifySchema = (schema) => {
    if (typeof schema !== 'object' || schema === null) return;

    if (schema.type === 'object' && schema.properties) {
        if (schema.properties.start_time) {
            schema.properties.start_time.format = 'session-start-time';
        }
        if (schema.properties.end_time) {
            schema.properties.end_time.format = 'session-end-time';
        }
        Object.values(schema.properties).forEach(prop => {
            if (prop.type === 'string' && prop.format === 'date-time') {
                prop.format = 'activity-time';
            }
            modifySchema(prop);
        });
    } else if (schema.type === 'array' && schema.items) {
        modifySchema(schema.items);
    } else if (schema.anyOf || schema.oneOf || schema.allOf) {
        (schema.anyOf || schema.oneOf || schema.allOf).forEach(modifySchema);
    }
};

// Apply the custom formats to your schema
modifySchema(schema);

// Function to replace location values in the generated data
const replaceLocations = (obj) => {
    if (typeof obj !== 'object' || obj === null) return;

    Object.entries(obj).forEach(([key, value]) => {
        if (key.toLowerCase() === 'location') {
            obj[key] = locationNames[Math.floor(Math.random() * locationNames.length)];
        } else if (typeof value === 'object') {
            replaceLocations(value);
        }
    });
};

// Function to validate and sort timestamps
const validateAndSortTimestamps = (obj, startTime, endTime) => {
    const timestamps = [];

    const collectTimestamps = (o) => {
        if (typeof o !== 'object' || o === null) return;

        if (o.time_stamp) {
            const timestamp = moment(o.time_stamp);
            if (timestamp.isBetween(startTime, endTime, null, '[]')) {
                timestamps.push({ obj: o, time: timestamp });
            } else {
                // If timestamp is outside the range, generate a new one within the range
                const newTimestamp = moment(startTime.valueOf() + Math.random() * (endTime.valueOf() - startTime.valueOf()));
                o.time_stamp = newTimestamp.toISOString();
                timestamps.push({ obj: o, time: newTimestamp });
            }
        }

        Object.values(o).forEach(value => {
            if (typeof value === 'object') {
                collectTimestamps(value);
            }
        });
    };

    collectTimestamps(obj);

    // Sort timestamps
    timestamps.sort((a, b) => a.time.valueOf() - b.time.valueOf());

    // Reassign sorted timestamps
    timestamps.forEach((item, index) => {
        item.obj.time_stamp = item.time.toISOString();
    });
};

// Function to generate a single record
async function generateRecord() {
    jsf.option('alwaysFakeOptionals', true);
    
    // Reset time context for each record
    timeContext = {};
    
    const sample = await jsf.resolve(schema);
    
    const startTime = moment(sample.start_time);
    const endTime = moment(sample.end_time);
    
    // Validate and sort timestamps
    validateAndSortTimestamps(sample, startTime, endTime);
    
    return sample;
}

// Function to generate multiple records
async function generateMultipleRecords(count) {
    const records = [];
    for (let i = 0; i < count; i++) {
        const record = await generateRecord();
        records.push(record);
    }
    return records;
}

// Generate records and save to file
async function generateAndSaveRecords(numberOfRecords) {
    try {
        const records = await generateMultipleRecords(numberOfRecords);

        // Replace location values
        records.forEach(record => replaceLocations(record));
        
        const jsonData = JSON.stringify(records, null, 2);
        const outputPath = path.join(__dirname, '..', 'output', 'generated_records.json');
        fs.writeFileSync(outputPath, jsonData);
        console.log(`Generated ${numberOfRecords} records and saved to ${outputPath}`);
    } catch (error) {
        console.error('Error generating or saving records:', error);
    }
}

// Run the generation and saving process
generateAndSaveRecords(numberOfRecords);