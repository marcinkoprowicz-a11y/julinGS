// viewer.js - WebGL2 Gaussian Splatting Viewer
// źródło bazowe: https://github.com/antimatter15/splat
// przerobione na wersję standalone dla GitHub Pages

let gl, program, canvas;
let projectionMatrix, viewMatrix;
let vertexBuffer, colorBuffer, radiusBuffer, numPoints = 0;
let mouseDown = false, lastX, lastY, yaw = 0, pitch = 0, distance = 3;

function createShader(type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    throw new Error("Błąd w shaderze");
  }
  return shader;
}

function createProgram(vsSrc, fsSrc) {
  const vs = createShader(gl.VERTEX_SHADER, vsSrc);
  const fs = createShader(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    throw new Error("Błąd w programie shaderów");
  }
  return prog;
}

function perspective(fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0
  ];
}

function lookAt(eye, center, up) {
  const z = normalize(subtract(eye, center));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
  ];
}

function subtract(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross(a, b) {
  return [
    a[1]*b[2]-a[2]*b[1],
    a[2]*b[0]-a[0]*b[2],
    a[0]*b[1]-a[1]*b[0]
  ];
}
function dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0]/l, a[1]/l, a[2]/l];
}

function initGL() {
  canvas = document.getElementById("canvas");
  gl = canvas.getContext("webgl2", { antialias: true });
  if (!gl) {
    alert("Twoja przeglądarka nie obsługuje WebGL2.");
    return;
  }
  resize();
  window.addEventListener("resize", resize);

  const vsSource = `
  attribute vec3 position;
  attribute vec3 color;
  uniform mat4 projection, view;
  varying vec3 vColor;
  void main() {
    gl_Position = projection * view * vec4(position, 1.0);
    gl_PointSize = 2.0;
    vColor = color;
  }`;

  const fsSource = `
  precision highp float;
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - vec2(0.5));
    if (r > 0.5) discard;
    gl_FragColor = vec4(vColor, 1.0);
  }`;

  program = createProgram(vsSource, fsSource);
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  vertexBuffer = gl.createBuffer();
  colorBuffer = gl.createBuffer();
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
  projectionMatrix = perspective(Math.PI / 3, canvas.width / canvas.height, 0.01, 100.0);
}

function setupInteraction() {
  canvas.addEventListener("mousedown", e => {
    mouseDown = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("mouseup", () => mouseDown = false);
  window.addEventListener("mousemove", e => {
    if (!mouseDown) return;
    yaw += (e.clientX - lastX) * 0.005;
    pitch += (e.clientY - lastY) * 0.005;
    pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("wheel", e => {
    distance *= (1 + e.deltaY * 0.001);
    distance = Math.min(Math.max(distance, 0.5), 20);
  });
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const eye = [
    distance * Math.cos(pitch) * Math.sin(yaw),
    distance * Math.sin(pitch),
    distance * Math.cos(pitch) * Math.cos(yaw)
  ];
  viewMatrix = lookAt(eye, [0,0,0], [0,1,0]);

  gl.uniformMatrix4fv(gl.getUniformLocation(program, "projection"), false, projectionMatrix);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, "view"), false, viewMatrix);

  const posLoc = gl.getAttribLocation(program, "position");
  const colLoc = gl.getAttribLocation(program, "color");
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(posLoc);

  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.vertexAttribPointer(colLoc, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(colLoc);

  gl.drawArrays(gl.POINTS, 0, numPoints);
}

async function loadSplat(url) {
  document.getElementById('loading').style.display = 'block';
  initGL();
  setupInteraction();

  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const data = new Float32Array(buffer);

  // Format danych: [x, y, z, r, g, b, ...]
  numPoints = data.length / 6;
  const positions = new Float32Array(numPoints * 3);
  const colors = new Float32Array(numPoints * 3);
  for (let i = 0; i < numPoints; i++) {
    positions.set(data.slice(i * 6, i * 6 + 3), i * 3);
    colors.set(data.slice(i * 6 + 3, i * 6 + 6), i * 3);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

  document.getElementById('loading').style.display = 'none';
  renderLoop();
}
