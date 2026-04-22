const canvas = document.getElementById("canvas");
const gl = canvas.getContext("webgl");
const img = document.getElementById("sourceImage");

// 캔버스 크기 설정
const setCanvasSize = () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
};
setCanvasSize();

// 셰이더 생성
const vsSource = `
      attribute vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

const fsSource = document.getElementById("fragShader").textContent;

const createShader = (type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

// 프로그램 생성
const vs = createShader(gl.VERTEX_SHADER, vsSource);
const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
const program = gl.createProgram();

gl.attachShader(program, vs);
gl.attachShader(program, fs);
gl.linkProgram(program);
gl.useProgram(program);

// 버퍼 설정
const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
  gl.STATIC_DRAW
);

const position = gl.getAttribLocation(program, "position");
gl.enableVertexAttribArray(position);
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

// 유니폼 위치
const uniforms = {
  resolution: gl.getUniformLocation(program, "iResolution"),
  time: gl.getUniformLocation(program, "iTime"),
  mouse: gl.getUniformLocation(program, "iMouse"),
  texture: gl.getUniformLocation(program, "iChannel0"),
};

// 마우스 추적
let mouse = [0, 0];
canvas.addEventListener("mousemove", (e) => {
  mouse = [e.clientX, canvas.height - e.clientY];
});

// 텍스처 설정
const texture = gl.createTexture();
const setupTexture = () => {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    img
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};

if (img.complete) {
  setupTexture();
} else {
  img.onload = setupTexture;
}

// 렌더링
const startTime = performance.now();
const render = () => {
  const currentTime = (performance.now() - startTime) / 1000;

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.uniform3f(uniforms.resolution, canvas.width, canvas.height, 1.0);
  gl.uniform1f(uniforms.time, currentTime);
  gl.uniform4f(uniforms.mouse, mouse[0], mouse[1], 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(uniforms.texture, 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  requestAnimationFrame(render);
};

// 리사이즈 이벤트
window.addEventListener("resize", setCanvasSize);

render();