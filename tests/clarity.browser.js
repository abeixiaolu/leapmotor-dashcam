import { CLARITY_FRAGMENT_SHADER } from "../src/clarityShader.ts";

const canvas = document.createElement("canvas");
const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
const results = [];

function check(name, pass, details = {}) {
  results.push({ name, pass, ...details });
}

function shader(type, source) {
  const compiled = gl.createShader(type);
  gl.shaderSource(compiled, source);
  gl.compileShader(compiled);
  check("shader compiles", gl.getShaderParameter(compiled, gl.COMPILE_STATUS), {
    log: gl.getShaderInfoLog(compiled),
  });
  return compiled;
}

function pixels(draw) {
  const source = document.createElement("canvas");
  source.width = 256;
  source.height = 128;
  const context = source.getContext("2d");
  const image = context.createImageData(source.width, source.height);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const color = draw(x, y);
      const offset = (y * source.width + x) * 4;
      image.data.set([...color, 255], offset);
    }
  }
  context.putImageData(image, 0, 0);
  return source;
}

function difference(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

function edgeWidth(data) {
  const row = Array.from({ length: 128 }, (_, x) => data[(32 * 128 + x) * 4]);
  const low = row[16];
  const high = row[112];
  const crossing = (fraction) => {
    const target = low + (high - low) * fraction;
    for (let x = 1; x < row.length; x++) {
      if (row[x] >= target && row[x - 1] < target) {
        return x - 1 + (target - row[x - 1]) / (row[x] - row[x - 1]);
      }
    }
    throw new Error("Edge has no crossing");
  };
  return crossing(0.9) - crossing(0.1);
}

function deviation(data) {
  let sum = 0;
  let squared = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += data[i];
    squared += data[i] ** 2;
  }
  const count = data.length / 4;
  return Math.sqrt(squared / count - (sum / count) ** 2);
}

try {
  check("WebGL available", Boolean(gl));
  const program = gl.createProgram();
  gl.attachShader(
    program,
    shader(
      gl.VERTEX_SHADER,
      "attribute vec2 pos; varying vec2 uv; void main(){uv=vec2(pos.x*.5+.5,.5-pos.y*.5);gl_Position=vec4(pos,0.,1.);}",
    ),
  );
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, CLARITY_FRAGMENT_SHADER));
  gl.linkProgram(program);
  check("shader links", gl.getProgramParameter(program, gl.LINK_STATUS));
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
    gl.texParameteri(gl.TEXTURE_2D, axis, gl.CLAMP_TO_EDGE);
  }
  for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
    gl.texParameteri(gl.TEXTURE_2D, filter, gl.LINEAR);
  }

  function render(source, { mode = 1, amount = 0.5, quadrant = [0, 0], correction = 0 } = {}) {
    canvas.width = source.width / 2;
    canvas.height = source.height / 2;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(gl.getUniformLocation(program, "quadrant"), ...quadrant);
    gl.uniform2f(gl.getUniformLocation(program, "pixel"), 1 / source.width, 1 / source.height);
    for (const [name, value] of Object.entries({
      clarityMode: mode,
      clarityAmount: amount,
      fov: 110,
      strength: correction,
    })) {
      gl.uniform1f(gl.getUniformLocation(program, name), value);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL rendering error");
    return data;
  }

  const blurredEdge = pixels((x) => {
    const value = 64 + 128 / (1 + Math.exp(-((x % 128) - 64) / 2));
    return [value, value, value];
  });
  const original = render(blurredEdge, { mode: 0 });
  const enhanced = render(blurredEdge);
  const beforeWidth = edgeWidth(original);
  const afterWidth = edgeWidth(enhanced);
  check(
    "default strength narrows a blurred edge by at least 15%",
    afterWidth <= beforeWidth * 0.85,
    {
      beforeWidth,
      afterWidth,
    },
  );
  check(
    "zero strength equals original",
    difference(original, render(blurredEdge, { amount: 0 })) === 0,
  );
  const comparison = render(blurredEdge, { mode: 2 });
  const splitExpected = original.map((value, index) =>
    Math.floor(index / 4) % 128 < 64 ? value : enhanced[index],
  );
  check(
    "comparison uses exactly the original and enhanced halves",
    difference(comparison, splitExpected) === 0,
  );

  const colors = [
    [180, 40, 60],
    [60, 180, 40],
    [40, 60, 180],
    [128, 128, 128],
  ];
  const quadrants = pixels((x, y) => colors[(x >= 128 ? 1 : 0) + (y >= 64 ? 2 : 0)]);
  for (const correction of [0, 1]) {
    for (let index = 0; index < 4; index++) {
      const expected = render(
        pixels(() => colors[index]),
        { amount: 1, correction },
      );
      const actual = render(quadrants, {
        amount: 1,
        correction,
        quadrant: [index % 2, Math.floor(index / 2)],
      });
      check("filter never samples another camera", difference(expected, actual) === 0, {
        index,
        correction,
      });
    }
  }

  let seed = 56789;
  const noise = pixels(() => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 128 + (seed % 5) - 2;
    return [value, value, value];
  });
  const inputNoise = deviation(render(noise, { mode: 0 }));
  const outputNoise = deviation(render(noise, { amount: 1 }));
  check(
    "low-amplitude flat noise is not sharpened beyond the tone curve",
    outputNoise <= inputNoise * 1.4,
    { inputNoise, outputNoise },
  );

  const sharpEdge = pixels((x) => {
    const value = x % 128 < 64 ? 64 : 192;
    return [value, value, value];
  });
  const sharp = render(sharpEdge, { amount: 1 });
  const low = render(
    pixels(() => [64, 64, 64]),
    { amount: 1 },
  )[0];
  const high = render(
    pixels(() => [192, 192, 192]),
    { amount: 1 },
  )[0];
  let minimum = 255;
  let maximum = 0;
  for (let i = 0; i < sharp.length; i += 4) {
    minimum = Math.min(minimum, sharp[i]);
    maximum = Math.max(maximum, sharp[i]);
  }
  check(
    "strong-edge halos stay within 20 levels at maximum strength",
    minimum >= low - 20 && maximum <= high + 20,
    { low, high, minimum, maximum },
  );

  const ramp = pixels((x) => [(x % 128) * 2, (x % 128) * 2, (x % 128) * 2]);
  const mapped = render(ramp, { amount: 1 });
  let monotonic = true;
  for (let x = 1; x < 128; x++)
    if (mapped[(32 * 128 + x) * 4] < mapped[(32 * 128 + x - 1) * 4]) monotonic = false;
  check("tone ramp retains order without reversals", monotonic);
} catch (error) {
  results.push({ name: "execution", pass: false, error: String(error) });
}
const report = {
  passed: results.filter((result) => result.pass).length,
  failed: results.filter((result) => !result.pass).length,
  results,
};
document.querySelector("#result").textContent = JSON.stringify(report, null, 2);
document.title = report.failed ? "FAIL: video clarity" : "PASS: video clarity";
