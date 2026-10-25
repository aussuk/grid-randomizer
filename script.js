"use strict";
(() => {
  const WIDTH = 1000;
  const HEIGHT = 700;
      const controls = {
        generationMode: document.querySelector("#generationMode"),
        rows: document.querySelector("#rowCount"),
        columns: document.querySelector("#columnCount"),
        wildness: document.querySelector("#wildness"),
        oppositeSides: document.querySelector("#oppositeSides"),
        crossingAngle: document.querySelector("#crossingAngle"),
        lineWidth: document.querySelector("#lineWidth"),
        background: document.querySelector("#backgroundColor"),
        line: document.querySelector("#lineColor"),
        fill: document.querySelector("#fillColor"),
        alternateFill: document.querySelector("#alternateFillColor"),
        fillPattern: document.querySelector("#fillPattern")
      };
      const svg = document.querySelector("#artwork");
      const faceLayer = document.querySelector("#faceLayer");
      const lineLayer = document.querySelector("#lineLayer");
      const status = document.querySelector("#validationStatus");
      const statusText = document.querySelector("#statusText");
      const generateButton = document.querySelector("#generateButton");
      const modeHint = document.querySelector("#modeHint");
      const oppositeSidesHint = document.querySelector("#oppositeSidesHint");
      const crossingAngleHint = document.querySelector("#crossingAngleHint");
      const imageViewer = document.querySelector("#imageViewer");
      const viewerViewport = document.querySelector("#viewerViewport");
      const viewerCanvas = document.querySelector("#viewerCanvas");
      const zoomLevel = document.querySelector("#zoomLevel");
      const zoomOutButton = document.querySelector("#zoomOutButton");
      const zoomInButton = document.querySelector("#zoomInButton");
      let viewerZoom = 1;
      const activeTouches = new Map();
      let pinchStart = null;
      let lastValid = null;

      function updateViewerZoom() {
        const viewerArtwork = viewerCanvas.querySelector("svg");
        if (!viewerArtwork) return;
        viewerArtwork.style.width = `${viewerViewport.clientWidth * viewerZoom}px`;
        zoomLevel.value = `${Math.round(viewerZoom * 100)}%`;
        zoomOutButton.disabled = viewerZoom <= .5;
        zoomInButton.disabled = viewerZoom >= 4;
      }

      function zoomViewer(nextZoom, clientX, clientY) {
        const artwork = viewerCanvas.querySelector("svg");
        if (!artwork) return;
        const next = Math.max(.5, Math.min(4, nextZoom));
        if (next === viewerZoom) return;

        const viewportRect = viewerViewport.getBoundingClientRect();
        const artworkRect = artwork.getBoundingClientRect();
        const anchorX = clientX - artworkRect.left;
        const anchorY = clientY - artworkRect.top;
        const anchorRatioX = artworkRect.width ? anchorX / artworkRect.width : .5;
        const anchorRatioY = artworkRect.height ? anchorY / artworkRect.height : .5;
        viewerZoom = next;
        updateViewerZoom();

        const scaledArtworkRect = artwork.getBoundingClientRect();
        viewerViewport.scrollLeft += scaledArtworkRect.left + anchorRatioX * scaledArtworkRect.width - clientX;
        viewerViewport.scrollTop += scaledArtworkRect.top + anchorRatioY * scaledArtworkRect.height - clientY;
      }

      function viewerCenter() {
        const rect = viewerViewport.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }

      function touchDistance(first, second) {
        return Math.hypot(first.x - second.x, first.y - second.y);
      }

      function touchMidpoint(first, second) {
        return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      }

      function syncViewerArtwork() {
        if (!imageViewer.open) return;
        const copy = svg.cloneNode(true);
        copy.removeAttribute("id");
        copy.setAttribute("role", "img");
        copy.setAttribute("aria-label", "Enlarged organic grid preview");
        for (const element of copy.querySelectorAll("[id]")) element.removeAttribute("id");
        viewerCanvas.replaceChildren(copy);
        updateViewerZoom();
      }

      function openImageViewer() {
        viewerZoom = 1;
        imageViewer.showModal();
        syncViewerArtwork();
      }

      const setStatus = (state, text) => {
        status.dataset.state = state;
        statusText.textContent = text;
      };

      const readSettings = () => ({
        generationMode: controls.generationMode.value,
        rows: Number(controls.rows.value),
        columns: Number(controls.columns.value),
        horizontal: Number(controls.rows.value) - 1,
        vertical: Number(controls.columns.value) - 1,
        wildness: Number(controls.wildness.value) / 100,
        oppositeSides: controls.oppositeSides.checked,
        crossingAngle: controls.crossingAngle.checked,
        lineWidth: Number(controls.lineWidth.value) / 10,
        background: controls.background.value,
        line: controls.line.value,
        fill: controls.fill.value,
        alternateFill: controls.alternateFill.value,
        fillPattern: controls.fillPattern.value
      });

      function updateModeControls() {
        const routed = controls.generationMode.value === "routed";
        controls.oppositeSides.disabled = false;
        controls.crossingAngle.disabled = false;
        modeHint.textContent = routed
          ? "Independent monotone routes guarantee crossings; U-turns are not supported yet."
          : "Bends a regular grid while preserving its structure.";
        oppositeSidesHint.textContent = routed
          ? "Turn off to slide endpoints around the board boundary."
          : "Turn off to let endpoints slide to other board edges.";
        crossingAngleHint.textContent = routed
          ? "When on, keeps crossings ≥20°; turn off for sharper angles and wilder lines."
          : "Avoids narrow, triangle-like corners; may reduce wildness.";
      }

      function updateReadouts() {
        document.querySelector("#rowValue").value = controls.rows.value;
        document.querySelector("#columnValue").value = controls.columns.value;
        document.querySelector("#wildnessValue").value = `${controls.wildness.value}%`;
        document.querySelector("#lineWidthValue").value = (Number(controls.lineWidth.value) / 10).toFixed(1);
      }

      function bump(value, dimension) {
        return Math.sin(Math.PI * value / dimension);
      }

      function perimeterParameter(point) {
        const x = point.x / WIDTH;
        const y = point.y / HEIGHT;
        if (Math.abs(y) < 1e-7) return x / 4;
        if (Math.abs(x - 1) < 1e-7) return .25 + y / 4;
        if (Math.abs(y - 1) < 1e-7) return .5 + (1 - x) / 4;
        return .75 + (1 - y) / 4;
      }

      function createDeformation(settings, minGap, strengthScale = 1, includeShears = true, boundaryFalloff = 0) {
        const steps = settings.wildness === 0 || !includeShears ? 0 : 6;
        const operations = [];
        const boundaryCoefficients = [];
        let coefficientBudget = 0;
        let boundaryShift = 0;
        if (!settings.oppositeSides) {
          const boundaryBudget = Math.min(.45, Math.max(.2, .55 - settings.lineWidth * 2 / minGap));
          boundaryShift = (Math.random() - .5) * .5 * settings.wildness * strengthScale;
          for (let frequency = 1; frequency <= 4; frequency++) {
            const coefficient = Math.random() * 2 - 1;
            boundaryCoefficients.push(coefficient);
            coefficientBudget += Math.abs(coefficient);
          }
          const scale = coefficientBudget > boundaryBudget ? boundaryBudget / coefficientBudget : 1;
          for (let i = 0; i < boundaryCoefficients.length; i++) boundaryCoefficients[i] *= scale * strengthScale;
        }

        // The boundary slide has a strictly increasing perimeter map; each shear is monotone
        // in its moving coordinate. Their composition therefore preserves the grid topology.
        const widthAmplitude = Math.min(Math.max(0, minGap / 2 - settings.lineWidth * 1.35) * .72, WIDTH / Math.PI * .72);
        const heightAmplitude = Math.min(Math.max(0, minGap / 2 - settings.lineWidth * 1.35) * .72, HEIGHT / Math.PI * .72);
        for (let i = 0; i < steps; i++) {
          const axis = i % 2 === 0 ? "x" : "y";
          operations.push({
            axis,
            amplitude: (axis === "x" ? widthAmplitude : heightAmplitude) * settings.wildness * strengthScale * (.48 + Math.random() * .52),
            frequency: 1 + Math.floor(Math.random() * (1 + Math.round(settings.wildness * 2))),
            phase: Math.random() * Math.PI * 2
          });
        }

        const boundaryPoint = parameter => {
          const u = ((parameter % 1) + 1) % 1;
          if (u < .25) return { x: u * 4, y: 0 };
          if (u < .5) return { x: 1, y: (u - .25) * 4 };
          if (u < .75) return { x: 1 - (u - .5) * 4, y: 1 };
          return { x: 0, y: 1 - (u - .75) * 4 };
        };

        const mapPerimeter = parameter => {
          let mapped = parameter + boundaryShift;
          for (let i = 0; i < boundaryCoefficients.length; i++) {
            const frequency = i + 1;
            mapped += settings.wildness * boundaryCoefficients[i] *
              Math.sin(2 * Math.PI * frequency * parameter) / (2 * Math.PI * frequency);
          }
          return mapped;
        };

        const boundaryPreimages = [];
        for (let target = -1; target <= 2; target += .25) {
          let low = -2;
          let high = 3;
          for (let i = 0; i < 60; i++) {
            const middle = (low + high) / 2;
            if (mapPerimeter(middle) < target) low = middle;
            else high = middle;
          }
          const parameter = (low + high) / 2;
          if (parameter > 1e-9 && parameter < 1 - 1e-9) {
            boundaryPreimages.push(parameter, parameter + 1);
          }
        }

        const slideBoundary = point => {
          const x = point.x / WIDTH;
          const y = point.y / HEIGHT;
          const radius = Math.max(Math.abs(2 * x - 1), Math.abs(2 * y - 1));
          if (radius < 1e-9) return point;
          const boundary = { x: .5 + (x - .5) / radius, y: .5 + (y - .5) / radius };
          const parameter = perimeterParameter({ x: boundary.x * WIDTH, y: boundary.y * HEIGHT });
          const mappedBoundary = boundaryPoint(mapPerimeter(parameter));
          const slideStrength = radius ** boundaryFalloff;
          const slidX = .5 + radius * (boundary.x + slideStrength * (mappedBoundary.x - boundary.x) - .5);
          const slidY = .5 + radius * (boundary.y + slideStrength * (mappedBoundary.y - boundary.y) - .5);
          return { x: slidX * WIDTH, y: slidY * HEIGHT };
        };

        const deform = point => {
          let { x, y } = slideBoundary(point);
          for (const op of operations) {
            const wave = op.axis === "x"
              ? Math.sin(y / HEIGHT * Math.PI * 2 * op.frequency + op.phase) * bump(y, HEIGHT)
              : Math.sin(x / WIDTH * Math.PI * 2 * op.frequency + op.phase) * bump(x, WIDTH);
            if (op.axis === "x") {
              x += op.amplitude * wave * bump(x, WIDTH);
            } else {
              y += op.amplitude * wave * bump(y, HEIGHT);
            }
          }
          return { x, y };
        };
        deform.boundaryPreimages = boundaryPreimages;
        return deform;
      }

      function minimumCrossingAngle(deform, settings) {
        const horizontal = Array.from({ length: settings.horizontal }, (_, i) => HEIGHT * (i + 1) / (settings.horizontal + 1));
        const vertical = Array.from({ length: settings.vertical }, (_, i) => WIDTH * (i + 1) / (settings.vertical + 1));
        let minimum = 90;
        const delta = .5;
        for (const y of horizontal) {
          for (const x of vertical) {
            const horizontalBefore = deform({ x: x - delta, y });
            const horizontalAfter = deform({ x: x + delta, y });
            const verticalBefore = deform({ x, y: y - delta });
            const verticalAfter = deform({ x, y: y + delta });
            const hx = horizontalAfter.x - horizontalBefore.x;
            const hy = horizontalAfter.y - horizontalBefore.y;
            const vx = verticalAfter.x - verticalBefore.x;
            const vy = verticalAfter.y - verticalBefore.y;
            const cosine = Math.min(1, Math.abs((hx * vx + hy * vy) / (Math.hypot(hx, hy) * Math.hypot(vx, vy))));
            minimum = Math.min(minimum, Math.acos(cosine) * 180 / Math.PI);
          }
        }
        const measureBoundaryAngle = (boundaryPoint, insidePoint) => {
          const endpoint = deform(boundaryPoint);
          const inside = deform(insidePoint);
          const tangent = { x: inside.x - endpoint.x, y: inside.y - endpoint.y };
          const tolerance = 1e-4;
          let boundaryTangent;
          if (Math.abs(endpoint.y) < tolerance || Math.abs(endpoint.y - HEIGHT) < tolerance) {
            boundaryTangent = { x: 1, y: 0 };
          } else {
            boundaryTangent = { x: 0, y: 1 };
          }
          const cosine = Math.min(1, Math.abs(
            (tangent.x * boundaryTangent.x + tangent.y * boundaryTangent.y) /
            (Math.hypot(tangent.x, tangent.y) * Math.hypot(boundaryTangent.x, boundaryTangent.y))
          ));
          minimum = Math.min(minimum, Math.acos(cosine) * 180 / Math.PI);
        };
        for (const y of horizontal) {
          measureBoundaryAngle({ x: 0, y }, { x: 1, y });
          measureBoundaryAngle({ x: WIDTH, y }, { x: WIDTH - 1, y });
        }
        for (const x of vertical) {
          measureBoundaryAngle({ x, y: 0 }, { x, y: 1 });
          measureBoundaryAngle({ x, y: HEIGHT }, { x, y: HEIGHT - 1 });
        }
        return minimum;
      }

      function catmullRomPath(points, smoothness) {
        if (points.length < 2) return "";
        const tension = smoothness / 6;
        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 0; i < points.length - 1; i++) {
          const previous = points[Math.max(0, i - 1)];
          const current = points[i];
          const next = points[i + 1];
          const following = points[Math.min(points.length - 1, i + 2)];
          const c1 = {
            x: current.x + (next.x - previous.x) * tension,
            y: current.y + (next.y - previous.y) * tension
          };
          const c2 = {
            x: next.x - (following.x - current.x) * tension,
            y: next.y - (following.y - current.y) * tension
          };
          d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${next.x} ${next.y}`;
        }
        return d;
      }

      function sampleSmoothPath(points, smoothness, divisions = 6) {
        const result = [points[0]];
        const tension = smoothness / 6;
        for (let i = 0; i < points.length - 1; i++) {
          const previous = points[Math.max(0, i - 1)];
          const current = points[i];
          const next = points[i + 1];
          const following = points[Math.min(points.length - 1, i + 2)];
          const c1 = {
            x: current.x + (next.x - previous.x) * tension,
            y: current.y + (next.y - previous.y) * tension
          };
          const c2 = {
            x: next.x - (following.x - current.x) * tension,
            y: next.y - (following.y - current.y) * tension
          };
          for (let j = 1; j <= divisions; j++) {
            const t = j / divisions;
            const inverse = 1 - t;
            result.push({
              x: inverse ** 3 * current.x + 3 * inverse ** 2 * t * c1.x + 3 * inverse * t ** 2 * c2.x + t ** 3 * next.x,
              y: inverse ** 3 * current.y + 3 * inverse ** 2 * t * c1.y + 3 * inverse * t ** 2 * c2.y + t ** 3 * next.y
            });
          }
        }
        return result;
      }

      function cumulativeLengths(points) {
        const lengths = [0];
        for (let i = 1; i < points.length; i++) {
          lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
        }
        return lengths;
      }

      function buildSegmentIndex(route, cellSize = 32) {
        const buckets = new Map();
        const segments = [];
        for (let i = 0; i < route.points.length - 1; i++) {
          const a = route.points[i];
          const b = route.points[i + 1];
          const segment = {
            index: i, a, b,
            minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
            minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y)
          };
          segments.push(segment);
          const minCellX = Math.floor(segment.minX / cellSize);
          const maxCellX = Math.floor(segment.maxX / cellSize);
          const minCellY = Math.floor(segment.minY / cellSize);
          const maxCellY = Math.floor(segment.maxY / cellSize);
          for (let x = minCellX; x <= maxCellX; x++) {
            for (let y = minCellY; y <= maxCellY; y++) {
              const key = `${x},${y}`;
              if (!buckets.has(key)) buckets.set(key, []);
              buckets.get(key).push(segment);
            }
          }
        }
        return { segments, buckets, cellSize };
      }

      function nearbySegments(index, segment) {
        const nearby = new Set();
        const minCellX = Math.floor(segment.minX / index.cellSize);
        const maxCellX = Math.floor(segment.maxX / index.cellSize);
        const minCellY = Math.floor(segment.minY / index.cellSize);
        const maxCellY = Math.floor(segment.maxY / index.cellSize);
        for (let x = minCellX; x <= maxCellX; x++) {
          for (let y = minCellY; y <= maxCellY; y++) {
            const bucket = index.buckets.get(`${x},${y}`);
            if (bucket) for (const candidate of bucket) nearby.add(candidate);
          }
        }
        return nearby;
      }

      function pointAtDistance(points, lengths, distance) {
        let low = 0;
        let high = lengths.length - 1;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (lengths[middle] < distance) low = middle + 1;
          else high = middle;
        }
        const index = Math.max(1, low);
        const segmentLength = lengths[index] - lengths[index - 1];
        const t = segmentLength ? (distance - lengths[index - 1]) / segmentLength : 0;
        return {
          x: points[index - 1].x + (points[index].x - points[index - 1].x) * t,
          y: points[index - 1].y + (points[index].y - points[index - 1].y) * t
        };
      }

      function extractSubpath(points, lengths, start, end) {
        const part = [pointAtDistance(points, lengths, start)];
        for (let i = 1; i < points.length - 1; i++) {
          if (lengths[i] > start && lengths[i] < end) part.push(points[i]);
        }
        part.push(pointAtDistance(points, lengths, end));
        return part;
      }

      function segmentIntersection(a, b, c, d) {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const cdx = d.x - c.x;
        const cdy = d.y - c.y;
        const cross = (x1, y1, x2, y2) => x1 * y2 - y1 * x2;
        const denominator = cross(abx, aby, cdx, cdy);
        const qpx = c.x - a.x;
        const qpy = c.y - a.y;
        const scale = Math.max(1, Math.hypot(abx, aby), Math.hypot(cdx, cdy));
        const epsilon = scale * 1e-8;

        if (Math.abs(denominator) > epsilon) {
          const t = cross(qpx, qpy, cdx, cdy) / denominator;
          const u = cross(qpx, qpy, abx, aby) / denominator;
          if (t > 1e-8 && t < 1 - 1e-8 && u > 1e-8 && u < 1 - 1e-8) {
            return { kind: "proper", t, u, point: { x: a.x + t * abx, y: a.y + t * aby } };
          }
          if (t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) {
            const boundedT = Math.max(0, Math.min(1, t));
            return { kind: "touch", t: boundedT, u: Math.max(0, Math.min(1, u)), point: { x: a.x + boundedT * abx, y: a.y + boundedT * aby } };
          }
          return null;
        }

        const orientation = cross(qpx, qpy, abx, aby);
        if (Math.abs(orientation) > epsilon) return null;
        const overlapX = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
        const overlapY = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
        return overlapX >= -epsilon && overlapY >= -epsilon ? { kind: "touch" } : null;
      }

      function inspectRoutePair(first, second, collect) {
        const events = [];
        const firstLengths = first.lengths;
        const secondLengths = second.lengths;
        for (const segment of first.segmentIndex.segments) {
          for (const candidate of nearbySegments(second.segmentIndex, segment)) {
            if (segment.maxX < candidate.minX - 1e-7 || segment.minX > candidate.maxX + 1e-7 ||
                segment.maxY < candidate.minY - 1e-7 || segment.minY > candidate.maxY + 1e-7) continue;
            const hit = segmentIntersection(segment.a, segment.b, candidate.a, candidate.b);
            if (!hit) continue;
            if (!Number.isFinite(hit.t) || !Number.isFinite(hit.u)) return { invalid: true, crossings: events.length };
            const firstDistance = firstLengths[segment.index] + hit.t * (firstLengths[segment.index + 1] - firstLengths[segment.index]);
            const secondDistance = secondLengths[candidate.index] + hit.u * (secondLengths[candidate.index + 1] - secondLengths[candidate.index]);
            let event = events.find(candidate => Math.hypot(candidate.point.x - hit.point.x, candidate.point.y - hit.point.y) < 1e-5);
            if (!event) {
              event = { point: hit.point, firstDistance, secondDistance, proper: false };
              events.push(event);
            }
            if (hit.kind === "proper") event.proper = true;
          }
        }
        for (const event of events) {
          if (event.proper) continue;
          const firstTangent = tangentAtDistance(first, event.firstDistance);
          const secondTangent = tangentAtDistance(second, event.secondDistance);
          const cross = firstTangent.x * secondTangent.y - firstTangent.y * secondTangent.x;
          if (Math.abs(cross) <= Math.hypot(firstTangent.x, firstTangent.y) * Math.hypot(secondTangent.x, secondTangent.y) * 1e-5) {
            return { invalid: true, crossings: events.length };
          }
        }
        if (events.length > 1) return { invalid: true, crossings: events.length };
        if (collect && events.length === 1) {
          const event = events[0];
          collect.push({
            point: event.point,
            firstDistance: event.firstDistance,
            secondDistance: event.secondDistance
          });
        }
        return { invalid: false, crossings: events.length };
      }

      function tangentAtDistance(route, distance) {
        const delta = Math.min(0.75, route.lengths.at(-1) / 10000);
        const before = pointAtDistance(route.points, route.lengths, Math.max(0, distance - delta));
        const after = pointAtDistance(route.points, route.lengths, Math.min(route.lengths.at(-1), distance + delta));
        return { x: after.x - before.x, y: after.y - before.y };
      }

      function corridorFor(index, values, extent) {
        const center = values[index];
        const lower = index === 0 ? 0 : (values[index - 1] + center) / 2;
        const upper = index === values.length - 1 ? extent : (center + values[index + 1]) / 2;
        return { center, lower, upper };
      }

      function sampleParameters(crossings, divisions = 1200) {
        const parameters = new Set();
        for (let i = 0; i <= divisions; i++) parameters.add(i / divisions);
        for (const value of crossings) parameters.add(value);
        return Array.from(parameters).sort((a, b) => a - b);
      }

      function makeRoutes(settings, deform) {
        const horizontalBase = Array.from({ length: settings.horizontal }, (_, i) => HEIGHT * (i + 1) / (settings.horizontal + 1));
        const verticalBase = Array.from({ length: settings.vertical }, (_, i) => WIDTH * (i + 1) / (settings.vertical + 1));
        const routes = [];

        horizontalBase.forEach((y, index) => {
          const parameters = sampleParameters(verticalBase.map(x => x / WIDTH));
          routes.push({
            family: "horizontal", index,
            points: parameters.map(parameter => ({ parameter, point: deform({ x: parameter * WIDTH, y }) }))
          });
        });
        verticalBase.forEach((x, index) => {
          const parameters = sampleParameters(horizontalBase.map(y => y / HEIGHT));
          routes.push({
            family: "vertical", index,
            points: parameters.map(parameter => ({ parameter, point: deform({ x, y: parameter * HEIGHT }) }))
          });
        });
        const horizontal = routes.filter(route => route.family === "horizontal");
        const vertical = routes.filter(route => route.family === "vertical");
        for (const route of routes) {
          route.id = `${route.family === "horizontal" ? "H" : "V"}${route.index + 1}`;
        }
        for (const route of routes) {
          route.crosses = route.family === "horizontal"
            ? vertical.map(other => other.id)
            : horizontal.map(other => other.id);
        }
        return { routes, horizontalBase, verticalBase };
      }

      function pathFromPoints(points, close = false) {
        if (!points.length) return "";
        let path = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length; i++) path += ` L ${points[i].x} ${points[i].y}`;
        return close ? `${path} Z` : path;
      }

      function smoothLinePath(points) {
        if (points.length < 2) return "";
        let path = `M ${points[0].x} ${points[0].y}`;
        for (let i = 0; i < points.length - 1; i++) {
          const previous = points[Math.max(0, i - 1)];
          const current = points[i];
          const next = points[i + 1];
          const following = points[Math.min(points.length - 1, i + 2)];
          const control1 = {
            x: current.x + (next.x - previous.x) / 6,
            y: current.y + (next.y - previous.y) / 6
          };
          const control2 = {
            x: next.x - (following.x - current.x) / 6,
            y: next.y - (following.y - current.y) / 6
          };
          path += ` C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${next.x} ${next.y}`;
        }
        return path;
      }

      function extractFaces(validation) {
        const vertices = [];
        const makeVertex = (point, boundary = false) => {
          const vertex = { id: vertices.length, x: point.x, y: point.y, boundary, outgoing: [] };
          vertices.push(vertex);
          return vertex;
        };
        const edges = [];
        const addEdge = (from, to, points) => {
          const edge = { id: edges.length, from, to, points };
          edges.push(edge);
          const forward = { edge, from, to, twin: null, angle: Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) };
          const reversePoints = points.slice().reverse();
          const reverse = { edge, from: to, to: from, twin: forward, angle: Math.atan2(reversePoints[1].y - reversePoints[0].y, reversePoints[1].x - reversePoints[0].x) };
          forward.twin = reverse;
          from.outgoing.push(forward);
          to.outgoing.push(reverse);
        };

        const corners = [
          makeVertex({ x: 0, y: 0 }, true),
          makeVertex({ x: WIDTH, y: 0 }, true),
          makeVertex({ x: WIDTH, y: HEIGHT }, true),
          makeVertex({ x: 0, y: HEIGHT }, true)
        ];
        const routeEndpoints = new Map();
        for (const route of validation.routes) {
          routeEndpoints.set(`${route.family}-${route.index}-start`, makeVertex(route.points[0], true));
          routeEndpoints.set(`${route.family}-${route.index}-end`, makeVertex(route.points.at(-1), true));
        }
        const crossingsPerRoute = new Map();
        for (const crossing of validation.crossings) {
          const horizontalKey = `horizontal-${crossing.horizontal}`;
          const verticalKey = `vertical-${crossing.vertical}`;
          const vertex = makeVertex(crossing.point);
          if (!crossingsPerRoute.has(horizontalKey)) crossingsPerRoute.set(horizontalKey, []);
          if (!crossingsPerRoute.has(verticalKey)) crossingsPerRoute.set(verticalKey, []);
          crossingsPerRoute.get(horizontalKey).push({ distance: crossing.horizontalDistance, vertex });
          crossingsPerRoute.get(verticalKey).push({ distance: crossing.verticalDistance, vertex });
        }

        for (const route of validation.routes) {
          const key = `${route.family}-${route.index}`;
          const nodes = [
            { distance: 0, vertex: routeEndpoints.get(`${key}-start`) },
            ...(crossingsPerRoute.get(key) || []),
            { distance: route.lengths.at(-1), vertex: routeEndpoints.get(`${key}-end`) }
          ].sort((a, b) => a.distance - b.distance);
          for (let i = 0; i < nodes.length - 1; i++) {
            if (nodes[i + 1].distance - nodes[i].distance < 1e-6) return null;
            addEdge(nodes[i].vertex, nodes[i + 1].vertex, extractSubpath(route.points, route.lengths, nodes[i].distance, nodes[i + 1].distance));
          }
        }

        const boundaryVertices = [
          ...corners,
          ...Array.from(routeEndpoints.entries()).map(([, vertex]) => vertex)
        ];
        boundaryVertices.sort((a, b) => {
          const perimeterPosition = point => {
            if (Math.abs(point.y) < 1e-6) return point.x;
            if (Math.abs(point.x - WIDTH) < 1e-6) return WIDTH + point.y;
            if (Math.abs(point.y - HEIGHT) < 1e-6) return WIDTH + HEIGHT + (WIDTH - point.x);
            return WIDTH * 2 + HEIGHT + (HEIGHT - point.y);
          };
          return perimeterPosition(a) - perimeterPosition(b);
        });
        for (let i = 0; i < boundaryVertices.length; i++) {
          const from = boundaryVertices[i];
          const to = boundaryVertices[(i + 1) % boundaryVertices.length];
          if (from === to) return null;
          addEdge(from, to, [{ x: from.x, y: from.y }, { x: to.x, y: to.y }]);
        }

        for (const vertex of vertices) vertex.outgoing.sort((a, b) => a.angle - b.angle);
        const halfEdges = edges.flatMap(edge => edge.from.outgoing.filter(item => item.edge === edge));
        const visited = new Set();
        const faces = [];
        for (const start of halfEdges) {
          if (visited.has(start)) continue;
          const cycle = [];
          let current = start;
          let guard = halfEdges.length + 1;
          while (!visited.has(current) && guard-- > 0) {
            visited.add(current);
            cycle.push(current);
            const outgoing = current.to.outgoing;
            const twinIndex = outgoing.indexOf(current.twin);
            if (twinIndex < 0) return null;
            current = outgoing[(twinIndex - 1 + outgoing.length) % outgoing.length];
          }
          if (current !== start || cycle.length < 3) continue;
          const polygon = [];
          for (const halfEdge of cycle) {
            const points = halfEdge.from === halfEdge.edge.from ? halfEdge.edge.points : halfEdge.edge.points.slice().reverse();
            polygon.push(...points.slice(0, -1));
          }
          let area = 0;
          for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % polygon.length];
            area += a.x * b.y - b.x * a.y;
          }
          area /= 2;
          if (area > 1) faces.push({ points: polygon, area });
        }

        const expectedFaces = validation.horizontal.length * validation.vertical.length + validation.horizontal.length + validation.vertical.length + 1;
        return faces.length === expectedFaces ? faces : null;
      }

      function routeSlice(route, start, end) {
        const lower = Math.min(start, end);
        const upper = Math.max(start, end);
        const points = route.points
          .filter(sample => sample.parameter >= lower - 1e-10 && sample.parameter <= upper + 1e-10)
          .map(sample => sample.point);
        return start <= end ? points : points.reverse();
      }

      function makeBoundarySegment(from, to, deform, divisions = 48) {
        const startParameter = perimeterParameter(from);
        let endParameter = perimeterParameter(to);
        if (endParameter <= startParameter + 1e-9) endParameter += 1;
        const samples = new Set();
        for (let i = 0; i <= divisions; i++) samples.add(i / divisions);
        for (const parameter of deform.boundaryPreimages) {
          if (parameter > startParameter && parameter < endParameter) {
            samples.add((parameter - startParameter) / (endParameter - startParameter));
          }
        }
        const points = [];
        for (const t of Array.from(samples).sort((a, b) => a - b)) {
          points.push(deform({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }));
        }
        return points;
      }

      function createRoutedProfile(axis, index, count, settings, spacing) {
        const extent = axis === "horizontal" ? WIDTH : HEIGHT;
        const base = (axis === "horizontal" ? HEIGHT : WIDTH) * (index + 1) / (count + 1);
        const maxOffset = settings.crossingAngle
          ? Math.max(0, spacing * .16 - settings.lineWidth * .35)
          : Math.max(0, spacing * .44 - settings.lineWidth * .65);
        const startOffset = (Math.random() * 2 - 1) * maxOffset * .2 * settings.wildness;
        const endOffset = (Math.random() * 2 - 1) * maxOffset * .2 * settings.wildness;
        const amplitude = maxOffset * (settings.crossingAngle ? .38 : .78) * settings.wildness;
        const frequency = 1 + Math.floor(Math.random() * (1 + Math.round(settings.wildness *
          (settings.crossingAngle ? 4 : 6))));
        const phase = Math.random() * Math.PI * 2;
        const slopeLimit = settings.crossingAngle ? .28 : .9;
        const derivativeBound =
          (1.5 * Math.abs(endOffset - startOffset) + amplitude * 2 * Math.PI * frequency) / extent;
        const scale = derivativeBound > slopeLimit ? slopeLimit / derivativeBound : 1;
        const start = startOffset * scale;
        const end = endOffset * scale;
        const waveAmplitude = amplitude * scale;
        const evaluate = parameter => {
          const t = Math.max(0, Math.min(1, parameter));
          const smooth = t * t * (3 - 2 * t);
          const wave = 4 * t * (1 - t) * Math.sin(2 * Math.PI * frequency * t + phase);
          return base + start * (1 - smooth) + end * smooth + waveAmplitude * wave;
        };
        return { axis, index, base, evaluate };
      }

      function routedPoint(route, parameter) {
        const point = route.family === "horizontal"
          ? { x: parameter * WIDTH, y: route.profile.evaluate(parameter) }
          : { x: route.profile.evaluate(parameter), y: parameter * HEIGHT };
        return route.transform ? route.transform(point) : point;
      }

      function routeSliceByParameter(route, start, end) {
        const lower = Math.min(start, end);
        const upper = Math.max(start, end);
        const points = [routedPoint(route, lower)];
        for (const sample of route.points) {
          if (sample.parameter > lower + 1e-10 && sample.parameter < upper - 1e-10) {
            points.push(sample.point);
          }
        }
        points.push(routedPoint(route, upper));
        return start <= end ? points : points.reverse();
      }

      function generateRoutedGrid(settings) {
        const horizontalSpacing = HEIGHT / (settings.horizontal + 1);
        const verticalSpacing = WIDTH / (settings.vertical + 1);
        const horizontal = Array.from({ length: settings.horizontal }, (_, index) => ({
          family: "horizontal",
          index,
          id: `H${index + 1}`,
          profile: createRoutedProfile("horizontal", index, settings.horizontal, settings, horizontalSpacing),
          crossingParameters: [],
          crosses: []
        }));
        const vertical = Array.from({ length: settings.vertical }, (_, index) => ({
          family: "vertical",
          index,
          id: `V${index + 1}`,
          profile: createRoutedProfile("vertical", index, settings.vertical, settings, verticalSpacing),
          crossingParameters: [],
          crosses: []
        }));
        const crossingTable = horizontal.map(() => Array(vertical.length));
        const horizontalParameters = horizontal.map(() => new Set(Array.from({ length: 1201 }, (_, i) => i / 1200)));
        const verticalParameters = vertical.map(() => new Set(Array.from({ length: 1201 }, (_, i) => i / 1200)));
        let crossingAngle = 90;

        // Bounded route slopes make each opposite-family pair cross exactly once.
        for (const h of horizontal) {
          for (const v of vertical) {
            const evaluateDifference = x => v.profile.evaluate(h.profile.evaluate(x / WIDTH) / HEIGHT) - x;
            let low = 0;
            let high = WIDTH;
            if (evaluateDifference(low) <= 0 || evaluateDifference(high) >= 0) {
              throw new Error(`${h.id} and ${v.id} do not have a bounded crossing.`);
            }
            for (let iteration = 0; iteration < 48; iteration++) {
              const middle = (low + high) / 2;
              if (evaluateDifference(middle) > 0) low = middle;
              else high = middle;
            }
            const x = (low + high) / 2;
            const y = h.profile.evaluate(x / WIDTH);
            const horizontalParameter = x / WIDTH;
            const verticalParameter = y / HEIGHT;
            horizontalParameters[h.index].add(horizontalParameter);
            verticalParameters[v.index].add(verticalParameter);
            h.crossingParameters.push(horizontalParameter);
            v.crossingParameters.push(verticalParameter);
            h.crosses.push(v.id);
            v.crosses.push(h.id);

            const deltaX = Math.min(1, x, WIDTH - x);
            const deltaY = Math.min(1, y, HEIGHT - y);
            const horizontalSlope = (h.profile.evaluate((x + deltaX) / WIDTH) -
              h.profile.evaluate((x - deltaX) / WIDTH)) / (2 * deltaX);
            const verticalSlope = (v.profile.evaluate((y + deltaY) / HEIGHT) -
              v.profile.evaluate((y - deltaY) / HEIGHT)) / (2 * deltaY);
            const dot = horizontalSlope + verticalSlope;
            const cross = 1 - horizontalSlope * verticalSlope;
            crossingAngle = Math.min(crossingAngle,
              Math.atan2(Math.abs(cross), Math.abs(dot)) * 180 / Math.PI);
            crossingTable[h.index][v.index] = {
              x, y, horizontalParameter, verticalParameter
            };
          }
        }

        const routes = [...horizontal, ...vertical];
        for (const route of routes) {
          const parameters = route.family === "horizontal"
            ? horizontalParameters[route.index]
            : verticalParameters[route.index];
          route.points = Array.from(parameters).sort((a, b) => a - b)
            .map(parameter => ({ parameter, point: routedPoint(route, parameter) }));
        }

        const checkFamilyOrder = (family, count) => {
          const ordered = family === "horizontal" ? horizontal : vertical;
          for (let sample = 0; sample <= 120; sample++) {
            const parameter = sample / 120;
            let previous = -Infinity;
            for (const route of ordered) {
              const coordinate = route.profile.evaluate(parameter);
              if (coordinate - previous < settings.lineWidth * 1.5 ||
                  coordinate <= 0 || coordinate >= (family === "horizontal" ? HEIGHT : WIDTH)) {
                throw new Error("Independent routing could not preserve line clearance.");
              }
              previous = coordinate;
            }
          }
          if (ordered.length !== count) throw new Error("The route family is incomplete.");
        };
        checkFamilyOrder("horizontal", settings.horizontal);
        checkFamilyOrder("vertical", settings.vertical);
        for (const route of routes) {
          const expectedCrosses = route.family === "horizontal" ? vertical.length : horizontal.length;
          if (route.crosses.length !== expectedCrosses || new Set(route.crosses).size !== expectedCrosses) {
            throw new Error(`${route.id} is missing a unique required crossing.`);
          }
        }
        if (settings.crossingAngle && crossingAngle < 20) {
          throw new Error(`A routed crossing fell below 20° (${crossingAngle.toFixed(1)}°).`);
        }

        const minGap = Math.min(horizontalSpacing, verticalSpacing);
        const measureCrossingAngle = transform => {
          let minimum = 90;
          const epsilon = 1e-4;
          const mapPoint = (route, parameter) => {
            const point = route.family === "horizontal"
              ? { x: parameter * WIDTH, y: route.profile.evaluate(parameter) }
              : { x: route.profile.evaluate(parameter), y: parameter * HEIGHT };
            return transform ? transform(point) : point;
          };
          for (const h of horizontal) {
            for (const v of vertical) {
              const crossing = crossingTable[h.index][v.index];
              const hBefore = mapPoint(h, Math.max(0, crossing.horizontalParameter - epsilon));
              const hAfter = mapPoint(h, Math.min(1, crossing.horizontalParameter + epsilon));
              const vBefore = mapPoint(v, Math.max(0, crossing.verticalParameter - epsilon));
              const vAfter = mapPoint(v, Math.min(1, crossing.verticalParameter + epsilon));
              const hx = hAfter.x - hBefore.x;
              const hy = hAfter.y - hBefore.y;
              const vx = vAfter.x - vBefore.x;
              const vy = vAfter.y - vBefore.y;
              const cosine = Math.min(1, Math.abs(
                (hx * vx + hy * vy) / (Math.hypot(hx, hy) * Math.hypot(vx, vy))
              ));
              minimum = Math.min(minimum, Math.acos(cosine) * 180 / Math.PI);
            }
          }
          return minimum;
        };
        let deformation = null;
        if (!settings.oppositeSides) {
          let strengthScale = settings.crossingAngle ? .2 : 1;
          for (let attempt = 0; attempt < 20; attempt++) {
            const candidate = createDeformation(
              settings,
              minGap,
              strengthScale,
              !settings.crossingAngle,
              settings.crossingAngle ? 8 : 0
            );
            const candidateAngle = measureCrossingAngle(candidate);
            if (!settings.crossingAngle || candidateAngle >= 20) {
              deformation = candidate;
              crossingAngle = candidateAngle;
              break;
            }
            strengthScale *= .5;
          }
          if (!deformation) {
            throw new Error("Could not slide endpoints while keeping crossings above 20°.");
          }
          for (const route of routes) {
            route.transform = deformation;
            for (const sample of route.points) sample.point = deformation(sample.point);
          }
          for (const row of crossingTable) {
            for (const crossing of row) {
              const point = deformation(crossing);
              crossing.x = point.x;
              crossing.y = point.y;
            }
          }
        }

        const faces = [];
        const boundarySegment = (from, to) => deformation
          ? makeBoundarySegment(from, to, deformation)
          : [from, to];
        const horizontalPoint = (routeIndex, verticalIndex) => verticalIndex < 0
          ? { x: 0, y: horizontal[routeIndex].profile.evaluate(0) }
          : verticalIndex >= vertical.length
            ? { x: WIDTH, y: horizontal[routeIndex].profile.evaluate(1) }
            : crossingTable[routeIndex][verticalIndex];
        const topBoundaryPoint = verticalIndex => verticalIndex < 0
          ? { x: 0, y: 0 }
          : verticalIndex >= vertical.length
            ? { x: WIDTH, y: 0 }
            : { x: vertical[verticalIndex].profile.evaluate(0), y: 0 };
        const bottomBoundaryPoint = verticalIndex => verticalIndex < 0
          ? { x: 0, y: HEIGHT }
          : verticalIndex >= vertical.length
            ? { x: WIDTH, y: HEIGHT }
            : { x: vertical[verticalIndex].profile.evaluate(1), y: HEIGHT };
        const verticalPoint = (routeIndex, horizontalIndex) => horizontalIndex < 0
          ? { x: vertical[routeIndex].profile.evaluate(0), y: 0 }
          : horizontalIndex >= horizontal.length
            ? { x: vertical[routeIndex].profile.evaluate(1), y: HEIGHT }
            : crossingTable[horizontalIndex][routeIndex];

        for (let row = 0; row <= settings.horizontal; row++) {
          for (let column = 0; column <= settings.vertical; column++) {
            const leftHorizontal = row - 1;
            const rightHorizontal = row;
            const leftVertical = column - 1;
            const rightVertical = column;
            const top = row === 0
              ? boundarySegment(topBoundaryPoint(leftVertical), topBoundaryPoint(rightVertical))
              : routeSliceByParameter(horizontal[row - 1],
                leftVertical < 0 ? 0 : crossingTable[row - 1][leftVertical].horizontalParameter,
                rightVertical >= vertical.length ? 1 : crossingTable[row - 1][rightVertical].horizontalParameter);
            const right = column === settings.vertical
              ? boundarySegment(
                row === 0 ? { x: WIDTH, y: 0 } : horizontalPoint(row - 1, vertical.length),
                row === settings.horizontal ? { x: WIDTH, y: HEIGHT } : horizontalPoint(row, vertical.length))
              : routeSliceByParameter(vertical[column],
                leftHorizontal < 0 ? 0 : crossingTable[leftHorizontal][column].verticalParameter,
                rightHorizontal >= horizontal.length ? 1 : crossingTable[rightHorizontal][column].verticalParameter);
            const bottom = row === settings.horizontal
              ? boundarySegment(bottomBoundaryPoint(rightVertical), bottomBoundaryPoint(leftVertical))
              : routeSliceByParameter(horizontal[row],
                rightVertical >= vertical.length ? 1 : crossingTable[row][rightVertical].horizontalParameter,
                leftVertical < 0 ? 0 : crossingTable[row][leftVertical].horizontalParameter);
            const left = column === 0
              ? boundarySegment(
                row === settings.horizontal ? { x: 0, y: HEIGHT } : horizontalPoint(row, -1),
                row === 0 ? { x: 0, y: 0 } : horizontalPoint(row - 1, -1))
              : routeSliceByParameter(vertical[column - 1],
                rightHorizontal >= horizontal.length ? 1 : crossingTable[rightHorizontal][column - 1].verticalParameter,
                leftHorizontal < 0 ? 0 : crossingTable[leftHorizontal][column - 1].verticalParameter);
            faces.push({
              row,
              column,
              points: [...top.slice(0, -1), ...right.slice(0, -1), ...bottom.slice(0, -1), ...left.slice(0, -1)]
            });
          }
        }
        return {
          routes,
          faces,
          crossings: horizontal.length * vertical.length,
          crossingAngle,
          strategy: "routed"
        };
      }

      function generateGrid(settings) {
        if (settings.generationMode === "routed") return generateRoutedGrid(settings);
        const minGap = Math.min(HEIGHT / (settings.horizontal + 1), WIDTH / (settings.vertical + 1));
        let strengthScale = 1;
        let deform = createDeformation(settings, minGap, strengthScale);
        let crossingAngle = minimumCrossingAngle(deform, settings);
        while (settings.crossingAngle && crossingAngle < 20 && strengthScale > .001) {
          strengthScale *= .8;
          deform = createDeformation(settings, minGap, strengthScale);
          crossingAngle = minimumCrossingAngle(deform, settings);
        }
        if (settings.crossingAngle && crossingAngle < 20) {
          strengthScale = 0;
          deform = createDeformation(settings, minGap, strengthScale);
          crossingAngle = minimumCrossingAngle(deform, settings);
        }
        const { routes, horizontalBase, verticalBase } = makeRoutes(settings, deform);
        const horizontal = routes.filter(route => route.family === "horizontal");
        const vertical = routes.filter(route => route.family === "vertical");
        const faces = [];

        for (let row = 0; row <= settings.horizontal; row++) {
          const y0 = row === 0 ? 0 : horizontalBase[row - 1];
          const y1 = row === settings.horizontal ? HEIGHT : horizontalBase[row];
          for (let column = 0; column <= settings.vertical; column++) {
            const x0 = column === 0 ? 0 : verticalBase[column - 1];
            const x1 = column === settings.vertical ? WIDTH : verticalBase[column];
            const top = row === 0
              ? makeBoundarySegment({ x: x0, y: 0 }, { x: x1, y: 0 }, deform)
              : routeSlice(horizontal[row - 1], x0 / WIDTH, x1 / WIDTH);
            const right = column === settings.vertical
              ? makeBoundarySegment({ x: WIDTH, y: y0 }, { x: WIDTH, y: y1 }, deform)
              : routeSlice(vertical[column], y0 / HEIGHT, y1 / HEIGHT);
            const bottom = row === settings.horizontal
              ? makeBoundarySegment({ x: x1, y: HEIGHT }, { x: x0, y: HEIGHT }, deform)
              : routeSlice(horizontal[row], x1 / WIDTH, x0 / WIDTH);
            const left = column === 0
              ? makeBoundarySegment({ x: 0, y: y1 }, { x: 0, y: y0 }, deform)
              : routeSlice(vertical[column - 1], y1 / HEIGHT, y0 / HEIGHT);
            faces.push({
              row, column,
              points: [...top.slice(0, -1), ...right.slice(0, -1), ...bottom.slice(0, -1), ...left.slice(0, -1)]
            });
          }
        }
        const directedCrossings = new Set();
        const crossingPairs = new Set();
        const routeById = new Map(routes.map(route => [route.id, route]));
        for (const route of routes) {
          const expectedFamily = route.family === "horizontal" ? "vertical" : "horizontal";
          if (route.crosses.length !== (expectedFamily === "vertical" ? settings.vertical : settings.horizontal)) {
            throw new Error(`${route.id} is missing an opposite-family crossing.`);
          }
          if (new Set(route.crosses).size !== route.crosses.length) {
            throw new Error(`${route.id} contains a duplicate crossing.`);
          }
          for (const other of route.crosses) {
            const otherRoute = routeById.get(other);
            if (!otherRoute || otherRoute.family !== expectedFamily) {
              throw new Error(`${route.id} contains an invalid same-family crossing.`);
            }
            const directedPair = `${route.id}:${other}`;
            if (directedCrossings.has(directedPair)) throw new Error(`The crossing ${directedPair} was recorded twice.`);
            directedCrossings.add(directedPair);
            if (route.id < other) {
              if (!otherRoute.crosses.includes(route.id)) {
                throw new Error(`The crossing ${route.id}:${other} is not reciprocal.`);
              }
              crossingPairs.add(`${route.id}:${other}`);
            }
          }
        }
        const expectedCrossings = settings.horizontal * settings.vertical;
        if (crossingPairs.size !== expectedCrossings) {
          throw new Error("The crossing list is incomplete.");
        }
        return { routes, faces, crossings: crossingPairs.size, crossingAngle, strengthScale, strategy: "warp" };
      }

      function render(grid, settings) {
        document.querySelector("#backgroundRect").setAttribute("fill", settings.background);
        faceLayer.replaceChildren();
        lineLayer.replaceChildren();
        if (settings.fillPattern !== "none") {
          for (const face of grid.faces) {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", pathFromPoints(face.points, true));
            const color = settings.fillPattern === "checkerboard" && (face.row + face.column) % 2
              ? settings.alternateFill
              : settings.fill;
            path.setAttribute("fill", color);
            path.setAttribute("fill-opacity", "1");
            path.setAttribute("stroke", "none");
            faceLayer.append(path);
          }
        }
        for (const route of grid.routes) {
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          const samples = grid.strategy === "routed"
            ? route.points.filter((sample, index) =>
              index % 6 === 0 ||
              index === route.points.length - 1 ||
              route.crossingParameters.some(parameter => Math.abs(sample.parameter - parameter) < 1e-10))
            : route.points;
          const points = samples.map(sample => sample.point);
          path.setAttribute("d", smoothLinePath(points));
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", settings.line);
          path.setAttribute("stroke-width", String(settings.lineWidth));
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          lineLayer.append(path);
        }
        document.querySelector("#faceCount").textContent = `${grid.faces.length} faces · ${grid.crossings} guaranteed crossings`;
        syncViewerArtwork();
      }

      function generate() {
        generateButton.disabled = true;
        const settings = readSettings();
        setStatus("checking", settings.generationMode === "routed"
          ? "Routing independent lines through planned crossings…"
          : "Building topology-safe grid…");
        try {
          const grid = generateGrid(settings);
          lastValid = { grid, settings };
          render(grid, settings);
          const crossingLabel = grid.crossings === 1 ? "crossing" : "crossings";
          const angleStatus = settings.crossingAngle
            ? ` · corners ≥${Math.floor(grid.crossingAngle)}°`
            : grid.strategy === "routed"
              ? ` · minimum crossing angle ${Math.floor(grid.crossingAngle)}°`
              : "";
          const methodLabel = grid.strategy === "routed" ? "Independent routes" : "Topology-safe warp";
          setStatus("valid", `${methodLabel} · ${grid.crossings} ${crossingLabel}${angleStatus}`);
        } catch (error) {
          setStatus("error", `Grid generation failed: ${error.message}`);
        }
        generateButton.disabled = false;
      }

      function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      function serializeExportSvg() {
        const copy = svg.cloneNode(true);
        copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        copy.setAttribute("width", String(WIDTH));
        copy.setAttribute("height", String(HEIGHT));
        return new XMLSerializer().serializeToString(copy);
      }

      function exportSvg() {
        if (!lastValid) {
          setStatus("error", "Generate and validate a grid before exporting.");
          return;
        }
        const source = serializeExportSvg();
        downloadBlob(new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${source}`], { type: "image/svg+xml;charset=utf-8" }), "organic-grid.svg");
      }

      function exportPng() {
        if (!lastValid) {
          setStatus("error", "Generate and validate a grid before exporting.");
          return;
        }
        const source = serializeExportSvg();
        const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = WIDTH * 3;
          canvas.height = HEIGHT * 3;
          const context = canvas.getContext("2d");
          if (!context) {
            URL.revokeObjectURL(url);
            setStatus("error", "PNG export failed: canvas rendering is unavailable.");
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          canvas.toBlob(png => {
            if (!png) {
              setStatus("error", "PNG export failed: the browser could not encode the image.");
              return;
            }
            downloadBlob(png, "organic-grid-3000x2100.png");
          }, "image/png");
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          setStatus("error", "PNG export failed while reading the SVG artwork.");
        };
        image.src = url;
      }

      function randomize() {
        controls.rows.value = String(3 + Math.floor(Math.random() * 9));
        controls.columns.value = String(3 + Math.floor(Math.random() * 9));
        controls.wildness.value = String(45 + Math.floor(Math.random() * 56));
        controls.lineWidth.value = String(12 + Math.floor(Math.random() * 22));
        const palettes = [
          ["#f7f7f2", "#263b34", "#87b9a2"],
          ["#f5efe4", "#3c342f", "#d5a17b"],
          ["#eef2f5", "#24364b", "#92b7ce"],
          ["#f2eee8", "#493b3e", "#d5a7b1"],
          ["#f4f1e8", "#30392a", "#a7b77d"]
        ];
        const palette = palettes[Math.floor(Math.random() * palettes.length)];
        controls.background.value = palette[0];
        controls.line.value = palette[1];
        controls.fill.value = palette[2];
        controls.alternateFill.value = palette[0];
        controls.fillPattern.value = Math.random() > .18 ? "checkerboard" : "solid";
        updateReadouts();
        generate();
      }

      function refreshAppearance() {
        if (!lastValid) return;
        const settings = readSettings();
        render(lastValid.grid, settings);
        lastValid.settings = settings;
      }

      for (const control of [controls.rows, controls.columns, controls.wildness, controls.lineWidth]) {
        control.addEventListener("input", updateReadouts);
      }
      controls.generationMode.addEventListener("change", () => {
        updateModeControls();
        generate();
      });
      controls.crossingAngle.addEventListener("change", generate);
      controls.oppositeSides.addEventListener("change", generate);
      for (const control of [controls.lineWidth, controls.background, controls.line, controls.fill, controls.alternateFill, controls.fillPattern]) {
        control.addEventListener("input", refreshAppearance);
      }
      generateButton.addEventListener("click", generate);
      document.querySelector("#randomizeButton").addEventListener("click", randomize);
      document.querySelector("#exportSvgButton").addEventListener("click", exportSvg);
      document.querySelector("#exportPngButton").addEventListener("click", exportPng);
      svg.addEventListener("click", openImageViewer);
      svg.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openImageViewer();
        }
      });
      zoomOutButton.addEventListener("click", () => {
        const center = viewerCenter();
        zoomViewer(viewerZoom - .25, center.x, center.y);
      });
      zoomInButton.addEventListener("click", () => {
        const center = viewerCenter();
        zoomViewer(viewerZoom + .25, center.x, center.y);
      });
      viewerViewport.addEventListener("wheel", event => {
        event.preventDefault();
        zoomViewer(viewerZoom * Math.exp(-event.deltaY * .002), event.clientX, event.clientY);
      }, { passive: false });
      viewerViewport.addEventListener("pointerdown", event => {
        if (event.pointerType !== "touch") return;
        event.preventDefault();
        viewerViewport.setPointerCapture(event.pointerId);
        activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (activeTouches.size === 2) {
          const [first, second] = [...activeTouches.values()];
          pinchStart = { distance: touchDistance(first, second), zoom: viewerZoom };
        }
      });
      viewerViewport.addEventListener("pointermove", event => {
        if (!activeTouches.has(event.pointerId)) return;
        const previous = activeTouches.get(event.pointerId);
        activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (activeTouches.size >= 2 && pinchStart) {
          const [first, second] = [...activeTouches.values()];
          const distance = touchDistance(first, second);
          if (pinchStart.distance > 0) {
            const midpoint = touchMidpoint(first, second);
            zoomViewer(pinchStart.zoom * distance / pinchStart.distance, midpoint.x, midpoint.y);
          }
        } else {
          viewerViewport.scrollLeft -= event.clientX - previous.x;
          viewerViewport.scrollTop -= event.clientY - previous.y;
        }
      });
      const endViewerTouch = event => {
        if (!activeTouches.delete(event.pointerId)) return;
        pinchStart = null;
      };
      viewerViewport.addEventListener("pointerup", endViewerTouch);
      viewerViewport.addEventListener("pointercancel", endViewerTouch);
      document.querySelector("#closeViewerButton").addEventListener("click", () => imageViewer.close());
      imageViewer.addEventListener("click", event => {
        if (event.target === imageViewer) imageViewer.close();
      });
      window.addEventListener("resize", updateViewerZoom);
      updateModeControls();
      updateReadouts();
      generate();
    })();
  