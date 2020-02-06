function modulo(n,d) {
  return ((n % d) + d) % d;
}

var audioContext;
var lookahead;

var schedulerInterval = 10; // ms

var rate = 0;
var lastRate = 0;
var sequence = [""];
var keys = {};
var tuning;
var wave;

var sequencer;

var pressedKeys = new Set();
var voices = {};
var step=0;
var highlightedStep;
var stepTime=0;

const fields = {t:'text',
                k:'keymap',
                p:'partials',
                s:'scale',
                r:'rate',
                q:'sequence',
                n:'baseNote',
                f:'baseFreq'};


window.addEventListener('keydown', this.onkeydown);
window.addEventListener('keyup', this.onkeyup);

window.onload = function() {
  document.getElementById('keymap').oninput = changedKeymap;
  document.getElementById('partials').oninput = changedPartials;
  document.getElementById('scale').oninput = changedTuningString;
  document.getElementById('baseNote').oninput = changedTuningString;
  document.getElementById('baseFreq').oninput = changedTuningString;
  document.getElementById('sequence').oninput = changedSequence;
  document.getElementById('rate').oninput = changedRate;

  for (el of document.querySelectorAll('[contenteditable="plaintext-only"]'))
    el.onblur = () =>  window.history.replaceState({}, "", getLink());

  for (el of document.getElementsByClassName('single-line')) {
    el.addEventListener('keydown', (e) => {if (e.keyCode == 13) e.preventDefault();});
    el.addEventListener('paste', e => {
      let paste = (e.clipboardData || window.clipboardData).getData('text');
      document.execCommand("insertText", false, paste.replace(/[\r?\n]+/g,""));
      e.preventDefault();
    });
  }

  for (const [key,value] of new URLSearchParams(document.location.search.replace(/^\?|\/$/g,"")))
    if (key in fields) document.getElementById(fields[key]).innerHTML = decodeURIComponent(value);

  for (numbered of document.getElementsByClassName("numbered")) initNumbers(numbered);
};

window.onbeforeunload = () => {
   Module.ccall('free', 'void', ['number'], [tuning]);
   return null;
}

function parseMath(expr) {
  let result = Module.ccall('te_interp', 'number', ['string','number'], [expr, 0]);
  return isNaN(result) ? 0 : result;
}

function getStepAtTime(time) {
  return stepTime ? modulo(step + Math.floor(lastRate * (time - stepTime)), sequence.length) : 0;
}

function startContext(latencyHint, sampleRate) {
  if (!sampleRate) sampleRate = 192000;
  audioContext = new AudioContext({latencyHint: latencyHint, sampleRate: sampleRate});
  lookahead = schedulerInterval/1000 + audioContext.baseLatency;
  document.getElementById("splash").style.display = "none";

  changedTuningString();
  changedKeymap();
  changedPartials();
  changedSequence();
  changedRate();
  requestAnimationFrame(highlightStep);
}

function htmlToString(html) {
  return html.replace("<br>","\n").replace(/\n$/,"");
}

function highlightStep() {
  let currentStep = getStepAtTime(audioContext.currentTime);
  if (highlightedStep != currentStep) {
    if (highlightedStep) highlightedStep.style.color = "";
    highlightedStep = document.querySelector('#sequence').parentNode.firstChild.childNodes[currentStep];
    if (highlightedStep) highlightedStep.style.color = "white";
  }
  window.requestAnimationFrame(highlightStep);
}

function stepSequence() {
  let time = audioContext.currentTime;
  if (!stepTime) stepTime = time;
  lastRate = rate;

  while (stepTime < time + lookahead) {
    for (key in voices)
      if (!(pressedKeys.has(key)
          ||(sequence.length > step
             &&sequence[step].includes(key))))
        stopVoice(key, stepTime);

    if (sequence.length>step)
      for (let i=0; i<sequence[step].length; i++) {
        let key = sequence[step][i];
        startVoice(key, stepTime);
      }

    stepTime += Math.abs(1/rate);
    step = modulo(step + (rate>0 ? 1 : -1), sequence.length);
  }
}

function startVoice(key, time) {
  if (!(key in voices) && (key in keys)) {
    let freq = Module.ccall('noteToFreq', 'number', ['number', 'number'], [keys[key], tuning]);
    if (freq!=0) {
      let absFreq = Math.abs(freq);
      voices[key] = {osc: audioContext.createOscillator(),
                    gain: audioContext.createGain(),
                    fade: 0.5/absFreq};
      voices[key].osc.setPeriodicWave(wave);
      voices[key].osc.frequency.setValueAtTime(freq, time);
      voices[key].osc.connect(voices[key].gain);
      voices[key].gain.connect(audioContext.destination);
      voices[key].osc.start(time);
      voices[key].gain.gain.setValueAtTime(0, time);
      voices[key].gain.gain.setTargetAtTime(Math.min(0.5,20/absFreq), time, voices[key].fade);
    }
  }
}

function stopVoice(key, time) {
  if (key in voices) {
    voices[key].gain.gain.setTargetAtTime(0, time, voices[key].fade);
    voices[key].osc.stop(time + voices[key].fade * 10);
    delete voices[key];
  }
}

function onkeydown(e) {
  if (!(e.repeat || e.shiftKey || e.ctrlKey || e.metaKey)) {
    pressedKeys.add(e.key);
    startVoice(e.key, audioContext.currentTime);
  }
}

function onkeyup(e) {
  pressedKeys.delete(e.key);
  let time = audioContext.currentTime;
  if (rate==0 || !sequence[getStepAtTime(time)].includes(e.key))
    stopVoice(e.key, time);
}

function changedRate() {
  let expr = document.getElementById('rate').innerHTML;
  rate = parseMath(expr);

  if (rate==0) {
    for (key in voices) stopVoice(key, audioContext.currentTime);
    stepTime = null;
    step=0;
    clearInterval(sequencer);
  }
  else if (!stepTime) sequencer = setInterval(stepSequence, schedulerInterval);
}

function changedSequence() {
  let elm = document.getElementById('sequence');
  sequence = htmlToString(elm.innerHTML).split(/\r?\n/);
}

function changedKeymap() {
  let elm = document.getElementById('keymap');
  let lines = htmlToString(keymap.innerHTML).split(/\r?\n/);

  keys = {};

  for (let i=0; i<lines.length; i++)
    for (let j=0; j<lines[i].length; j++)
      keys[lines[i][j]] = i+1;
}

function changedTuningString() {

  let elm = document.getElementById("scale");
  let scale = htmlToString(elm.innerHTML);
  let baseNote = document.getElementById("baseNote").innerHTML;
  let baseFreq = document.getElementById("baseFreq").innerHTML;

  let tmp = Module.ccall('tuningFromString','number', ['string'],
    [baseNote + ":" + baseFreq + "\n" + scale]);
  if (tmp != 0) {
    Module.ccall('free', 'void', ['number'], [tuning]);
    tuning = tmp;
  }
}

function changedPartials() {
  let elm = document.getElementById("partials");
  let partials = [0, ...htmlToString(elm.innerHTML).split(/\r?\n/).map(parseMath)];
  wave = audioContext.createPeriodicWave(new Array(partials.length).fill(0), partials);
  for (voice of Object.values(voices)) {voice.osc.setPeriodicWave(wave);}
}

function getLink() {
  let str = "";
  for (const [key,value] of Object.entries(fields)) {
    str += "&" + key + "=" + encodeURIComponent(document.getElementById(value).innerHTML);
  }
  return str.replace(/^\&/,"?");
}

function initNumbers(numbered) {
  let container = document.createElement("div");
  let numbers = document.createElement("pre");
  numbered.parentNode.insertBefore(container, numbered);
  container.appendChild(numbers);
  container.appendChild(numbered);
  container.style.position = "relative";
  container.style.display = "inline-block";
  numbers.style.position = "absolute";
  numbers.style.textAlign = "right";
  numbers.style.top = "0";

  let style = window.getComputedStyle(numbered);
  numbers.style.padding = style.getPropertyValue('padding');
  numbers.style.margin = style.getPropertyValue('margin');
  numbers.style.fontSize = style.getPropertyValue('font-size');

  updateNumbers(numbered);
  numbered.addEventListener("input", () => {updateNumbers(numbered)});
}

function updateNumbers(numbered) {
  let numbers = numbered.parentNode.firstChild;

  numbers.innerHTML = '<div class="l1">1</div>';
  let line = 2;
  while (numbers.clientHeight < numbered.clientHeight)
  {
    numbers.insertAdjacentHTML("beforeend", '<div class="l'+line+'">'+line+"</div>");
    line++;
  }

  numbers.style.left = (-numbers.clientWidth).toString()+"px";
}