/**
 * Rule based plan used when the AI model is unavailable.
 * It keeps the app useful on a bad network day, and it is clearly labelled in the UI.
 */

/**
 * @param {string} title
 * @param {string} detail
 * @param {string} impact
 * @param {'free'|'low'|'medium'} [cost]
 * @param {'high'|'medium'|'low'} [benefit]
 */
const item = (title, detail, impact, cost = 'free', benefit = 'medium') => ({ title, detail, impact, cost, benefit });

const COMMUTE_SWAPS = {
  car: item(
    'Share the car or take the metro twice a week',
    'Pool with one colleague or neighbour, or switch two commute days to metro or bus.',
    'A shared car trip roughly halves the tailpipe emissions per person for that journey.',
    'free',
    'high',
  ),
  two_wheeler: item(
    'Swap short two wheeler trips for a bus or metro',
    'Use public transport for trips over five kilometres on high smog days.',
    'You breathe less roadside exhaust inside a bus or metro than in open traffic, and your trip adds less to it.',
    'free',
    'high',
  ),
  bus: item(
    'Keep using the bus and wait away from the kerb',
    'Stand a few metres back from the road at the stop and board from the upwind side.',
    'Pollution drops quickly with distance from traffic, so a few metres lowers what you inhale while waiting.',
  ),
  metro: item(
    'Keep the metro habit and walk the last stretch on side streets',
    'Pick a quieter lane for the walk to and from the station.',
    'Side streets carry far less exhaust than main roads, which cuts exposure on the walking part.',
  ),
  walk: item(
    'Walk on side streets and off the peak hour',
    'Shift walks to early afternoon when smog usually thins, and avoid main roads.',
    'Walking adds no emissions, and a cleaner route lowers the dose you take in.',
  ),
  cycle: item(
    'Cycle off peak with a fitted N95 mask',
    'Ride in early afternoon, on quieter roads, and at an easy pace.',
    'Hard breathing pulls in more particles, so a slower ride on a cleaner road lowers intake.',
  ),
  work_from_home: item(
    'Keep working from home on the worst days',
    'Group errands into one trip in the early afternoon.',
    'One combined trip means fewer cold engine starts, which are the dirtiest part of a short drive.',
  ),
};

const FUEL_SWAPS = {
  biomass: item(
    'Move one meal a day off wood or dung',
    'Cook one meal on LPG or an electric plate, and keep children out of the kitchen while the fire is lit.',
    'Solid fuel smoke is one of the largest sources of indoor particles, so each meal moved makes a clear difference.',
    'low',
    'high',
  ),
  kerosene: item(
    'Replace the kerosene stove when you can',
    'Use LPG or an induction plate, and until then cook near an open window with the door to other rooms shut.',
    'Kerosene burns dirty indoors, so switching removes a daily source of fine particles at home.',
    'medium',
    'high',
  ),
  lpg: item(
    'Run the exhaust fan while cooking',
    'Switch the fan on before lighting the burner and leave it on for ten minutes after.',
    'Gas flames release nitrogen dioxide, and venting clears most of it before it spreads through the home.',
  ),
  piped_gas: item(
    'Run the exhaust fan while cooking',
    'Switch the fan on before lighting the burner and leave it on for ten minutes after.',
    'Gas flames release nitrogen dioxide, and venting clears most of it before it spreads through the home.',
  ),
  electric: item(
    'Keep cooking electric and use lids',
    'Cover pans and use a pressure cooker where you can.',
    'Electric cooking adds no combustion gases indoors, and lids cut both energy use and cooking fumes.',
    'free',
    'low',
  ),
};

/**
 * Build a plan from fixed rules.
 * @param {import('./validate.js').PlanRequest} answers
 * @param {Pick<import('./types.js').AirReading, 'aqi'|'label'|'advice'|'peak'>} air
 * @param {string} placeName
 * @returns {import('./types.js').Plan}
 */
export function buildFallbackPlan(answers, air, placeName) {
  const severe = air.aqi > 150;
  const sensitive = answers.household.length > 0;
  const peakNote = air.peak
    ? ` The worst hour ahead is around ${air.peak.time.slice(11, 16)} (AQI ${air.peak.aqi}).`
    : '';

  const summary =
    `Air quality in ${placeName} is ${air.label.toLowerCase()} right now (AQI ${air.aqi}). ${air.advice}${peakNote}` +
    (sensitive ? ' Plan the day around the most vulnerable person at home.' : '');

  const routine = [
    item(
      severe ? 'Move outdoor time to early afternoon' : 'Keep outdoor time flexible',
      severe
        ? 'Smog is usually thickest in the early morning and late evening. Shift walks, play and errands to between noon and four.'
        : 'Check the reading before long outdoor effort and move it if the number climbs.',
      'Timing alone can cut the particles you breathe on a trip by a large share, at no cost.',
      'free',
      severe ? 'high' : 'medium',
    ),
    item(
      'Wear a fitted N95 mask outside',
      'Use an N95 or FFP2 that seals around the nose and cheeks. Cloth and surgical masks let fine particles through.',
      'A well fitted N95 filters about 95 percent of fine particles.',
      'low',
      'high',
    ),
    item(
      'Skip burning leaves, waste and firewood',
      'Compost garden waste and hand dry waste to the collector. Ask neighbours and guards to do the same.',
      'Open burning puts smoke straight into the street you live on, so stopping it helps the whole lane.',
    ),
  ];
  if (answers.outdoorTime === 'over_3h' || answers.household.includes('outdoor_worker')) {
    routine.push(
      item(
        'Take clean air breaks during long outdoor hours',
        'Step indoors for ten minutes every hour and drink water. Keep the mask on while working outside.',
        'Breaks lower the total dose over a long shift, which matters more than any single hour.',
      ),
    );
  }

  const indoor = [
    item(
      'Air the home at the cleanest hour, then shut it',
      'Open windows for fifteen minutes in early afternoon, and keep them closed in the morning and evening.',
      'This swaps stale air out without letting the peak smog in.',
    ),
    item(
      'Wet mop instead of dry sweeping',
      'Mop floors and wipe surfaces with a damp cloth once a day.',
      'Dry sweeping lifts settled dust back into the air you breathe; a wet mop removes it.',
    ),
    item(
      'Avoid incense, mosquito coils and indoor smoking',
      'Use a plug in repellent or nets, and keep any smoking outside and away from windows.',
      'Burning one coil in a closed room can release as much fine particle matter as dozens of cigarettes.',
      'free',
      'high',
    ),
  ];
  if (answers.hasPurifier) {
    indoor.push(
      item(
        'Run the purifier in the bedroom with the door shut',
        'Place it in the room where the most vulnerable person sleeps and check the filter is not overdue.',
        'A purifier only cleans the room it is in, so one closed room gives a real clean air refuge.',
        'free',
        'high',
      ),
    );
  } else if (answers.budget !== 'none') {
    indoor.push(
      item(
        'Make one clean room',
        'Seal window gaps in one bedroom with tape or cloth, and add a HEPA purifier or a box fan with a filter fitted to it.',
        'Sealing plus filtering in one small room can bring indoor particles down sharply for the hours you sleep.',
        'medium',
        'high',
      ),
    );
  } else {
    indoor.push(
      item(
        'Seal one bedroom for sleeping',
        'Block window and door gaps with rolled cloth or tape on bad nights.',
        'Fewer gaps means less outdoor smog leaking in while the family sleeps, at no cost.',
      ),
    );
  }

  const alternatives = [
    COMMUTE_SWAPS[/** @type {keyof typeof COMMUTE_SWAPS} */ (answers.commute)],
    FUEL_SWAPS[/** @type {keyof typeof FUEL_SWAPS} */ (answers.cookingFuel)],
    item(
      'Use an electric heater, not a fire, for warmth',
      'Avoid angithis, coal and wood fires indoors. Layer clothing first and heat one room.',
      'Indoor fires add smoke and carbon monoxide; electric heat adds neither inside the home.',
      'low',
      'high',
    ),
  ];

  return { summary, routine, indoor, alternatives };
}
