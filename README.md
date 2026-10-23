# Organic Grid Generator

A browser-based tool for generating wildly irregular grids from
complete, intersecting lines.

Unlike conventional grid generators that distort vertices or create
cells one at a time, this project starts with the **lines themselves**.
Each line can bend, loop, turn back on itself, and form deeply concave
regions, while the generator tries to preserve the structure needed for
every cell to remain a valid four-sided region.

> **Project status:** In development / algorithm design. Features
> described as planned are goals, not a claim that they are already
> implemented.

## The idea

The goal is to generate grids that can look almost chaotic at first
glance: long winding paths, deep concavities, narrow passages, and cells
with very different sizes and proportions.

The central idea is to generate complete lines first. The cells emerge
from the spaces between those lines.

## Design goals

-   Generate whole lines rather than constructing individual cells.
-   Allow highly irregular, smooth routes, including U-turns and large
    detours.
-   Support lines that either must reach the opposite boundary or may
    return to the side where they started.
-   Prevent a line from crossing another line in the same family.
-   Track which other lines each line crosses.
-   Prevent a line from crossing the same line more than once, including
    itself.
-   Require every opposite-family line to be crossed exactly once when
    the selected grid mode requires a complete grid.
-   Limit how far a line can wander so it does not block the routes
    needed by neighboring lines.
-   Detect and validate intersections before accepting a generated grid.
-   Derive enclosed cells from the completed line network, rather than
    generating cells individually.
-   Preview the result in a browser and export it as SVG and raster
    image formats.

## How the line rules work

Each line has an identifier, a family, a route, and a list of the other
lines it crosses.

For example, a line's crossing list might be represented as:

``` text
lineA: [lineE, lineN, lineW]
```

A valid line must not cross itself, must not cross the same line twice,
and must obey the crossing rules for its family.

### Families are not the same as sides

A line's **family** describes its role in the grid, not which boundary
it starts from. A line may turn around and return to the side it started
on. It must still avoid crossing lines from its own family.

### Boundary behaviour

A setting should control whether a line:

-   **Must reach the opposite boundary**, while still being allowed to
    turn back or make U-turns along the way; or
-   **May return to its starting boundary**, provided all other
    intersection and validity rules are satisfied.

### Crossing rules

For a complete grid mode:

1.  Lines in the same family must not cross one another.
2.  Every pair of lines from opposite families must cross exactly once.
3.  Crossings must be proper intersections, not tangencies or shared
    stretches.
4.  A line must not cross itself.
5.  A line must not cross another line more than once.
6.  The order and boundary constraints must remain compatible with the
    rest of the grid.

Other boundary modes may need different validation rules. The generator
should clearly report which rules were checked and whether the result
passed.

### Preventing lines from blocking one another

A line must not wander so far that it leaves no valid route for lines
that still need to be drawn.

A simple maximum-distance limit is useful, but it is not sufficient on
its own. The generator should also consider neighboring lines, their
boundary order, and the intersections still required. If a route makes
completion impossible, the generator should reject it or backtrack
rather than silently producing an invalid grid.

## Planned interface

The intended application is a standalone HTML page using HTML, CSS,
JavaScript, and SVG.

Potential controls include:

-   Number of lines in each family
-   Wildness / maximum deviation
-   Curve smoothness
-   Line width and color
-   Background and optional cell fills
-   Whether lines must reach the opposite boundary
-   Randomize / regenerate
-   Export size and image format

The exact controls may change as the algorithm develops.

## Export formats

-   **SVG:** resolution-independent vector output, ideal for editing and
    scaling.
-   **PNG:** raster output suitable for transparent backgrounds and
    general use.
-   **JPG:** optional raster export for uses that do not require
    transparency.

The exported image should match the preview.

## Algorithm overview

A possible generation pipeline is:

1.  Define the board boundaries and the line families.
2.  Establish each line's start and end constraints.
3.  Generate a candidate route using points connected by curves.
4.  Check the candidate against existing routes and its own route.
5.  Update the crossing lists.
6.  Check whether the remaining lines can still be drawn without
    violating the constraints.
7.  Reject or backtrack from routes that make completion impossible.
8.  Validate the completed network.
9.  Extract the actual faces of the planar network to identify cells.
10. Render the lines and optional fills, then export the result.

Curves can be approximated by short line segments during intersection
testing, then rendered smoothly. Any smoothing step must preserve the
validated intersection structure.

## Important geometry note

The crossing rules are necessary, but they do not automatically prove
that every enclosed region is a four-sided cell. A planar network can
contain faces with more than four boundary sections, and a face can
border the same line in multiple places.

The application should therefore validate the resulting planar
subdivision and its faces, not just count crossings. If the chosen rules
permit regions that are not quadrilaterals, the interface should report
that rather than claiming the grid is valid.

## Running the project

Once the first HTML implementation is available:

1.  Download or clone this repository.
2.  Open `index.html` in a modern browser.
3.  Generate a grid and adjust the settings.
4.  Export the result.

The intended implementation is client-side and should not require an
account or send drawings to a server.

## Contributing

Ideas, bug reports, test cases, and algorithm improvements are welcome.
Particularly useful contributions include:

-   Examples where a generated route blocks the remaining lines
-   Cases where two curves cross more than once
-   Cases where smoothing changes the crossing structure
-   Better ways to validate and extract the faces of the planar network
