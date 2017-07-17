define([
        '../Core/defined',
        '../Core/DeveloperError',
    ], function(
        defined,
        DeveloperError) {
    'use strict';

    // Note that this fails if your string looks like
    // searchString[singleCharacter]searchString
    function replaceInSourceString(str, replacement, splitSource) {
        var regexStr = '(^|[^\\w])(' + str + ')($|[^\\w])';
        var regex = new RegExp(regexStr, 'g');

        for (var number = 0; number < splitSource.length; ++number) {
            var line = splitSource[number];
            splitSource[number] = line.replace(regex, '$1' + replacement + '$3');
        }
    }

    function replaceInSourceRegex(regex, replacement, splitSource) {
        for (var number = 0; number < splitSource.length; ++number) {
            var line = splitSource[number];
            splitSource[number] = line.replace(regex, replacement);
        }
    }

    function findInSource(str, splitSource) {
        var regexStr = '(^|[^\\w])(' + str + ')($|[^\\w])';
        var regex = new RegExp(regexStr, 'g');
        for (var number = 0; number < splitSource.length; ++number) {
            var line = splitSource[number];
            if (regex.test(line)) {
                return true;
            }
        }
        return false;
    }

    function compileSource(splitSource) {
        var wholeSource = '';
        for (var number = 0; number < splitSource.length; ++number) {
            wholeSource += splitSource[number] + '\n';
        }
        return wholeSource;
    }

    function setAdd(variable, set1) {
        if (set1.indexOf(variable) === -1) {
            set1.push(variable);
        }
    }

    function getVariablePreprocessorBranch(variablesThatWeCareAbout, splitSource) {
        var variableMap = {};
        var negativeMap = {};

        var numVariablesWeCareAbout = variablesThatWeCareAbout.length;
        for (var a = 0; a < numVariablesWeCareAbout; ++a) {
            var variableThatWeCareAbout = variablesThatWeCareAbout[a];
            variableMap[variableThatWeCareAbout] = [null];
        }

        var stack = [];
        for (var i = 0; i < splitSource.length; ++i) {
            var line = splitSource[i];
            var hasIF = /(#ifdef|#if)/g.test(line);
            var hasELSE = /#else/g.test(line);
            var hasENDIF = /#endif/g.test(line);

            if (hasIF) {
                stack.push(line);
            } else if (hasELSE) {
                var top = stack[stack.length - 1];
                var op = top.replace('ifdef', 'ifndef');
                if (/if/g.test(op)) {
                    op = op.replace(/(#if\s+)(\S*)([^]*)/, '$1!($2)$3');
                }
                stack.pop();
                stack.push(op);

                negativeMap[top] = op;
                negativeMap[op] = top;
            } else if (hasENDIF) {
                stack.pop();
            } else if (!/layout/g.test(line)) {
                for (var varIndex = 0; varIndex < numVariablesWeCareAbout; ++varIndex) {
                    var varName = variablesThatWeCareAbout[varIndex];
                    if (line.indexOf(varName) !== -1) {
                        if (variableMap[varName].length === 1 && variableMap[varName][0] === null) {
                            variableMap[varName] = stack.slice();
                        } else {
                            variableMap[varName] = variableMap[varName].filter(function(x) {
                                return stack.indexOf(x) >= 0;
                            });
                        }
                    }
                }
            }
        }

        for (var care in variableMap) {
            if (variableMap.hasOwnProperty(care)) {
                if (variableMap.length === 1 && variableMap[0] === null) {
                    variableMap.splice(0, 1);
                }
            }
        }

        return variableMap;
    }

    function removeExtension(name, splitSource) {
        var regex = '#extension\\s+GL_' + name + '\\s+:\\s+[a-zA-Z0-9]+\\s*$';
        replaceInSourceRegex(new RegExp(regex, 'g'), '', splitSource);
    }

    /**
     * A function to port GLSL shaders from GLSL ES 1.00 to GLSL ES 3.00
     *
     * This function is nowhere near comprehensive or complete. It just
     * handles some common cases.
     *
     * Note that this function requires the presence of the
     * "#define OUTPUT_DECLARATION" line that is appended
     * by ShaderSource.
     *
     * @private
     */
    function modernizeShader(source, isFragmentShader) {
        var outputDeclarationRegex = /#define OUTPUT_DECLARATION/;
        var splitSource = source.split('\n');

        if (/#version 300 es/g.test(source)) {
            return source;
        }

        var outputDeclarationLine = -1;
        var number;
        for (number = 0; number < splitSource.length; ++number) {
            var line = splitSource[number];
            if (outputDeclarationRegex.exec(line)) {
                outputDeclarationLine = number;
                break;
            }
        }

        if (outputDeclarationLine === -1) {
            throw new DeveloperError('Could not find a #define OUTPUT_DECLARATION!');
        }

        var variableSet = [];

        for (var i = 0; i < 10; i++) {
            var fragDataString = 'gl_FragData\\[' + i + '\\]';
            var newOutput = 'czm_out' + i;
            var regex = new RegExp(fragDataString, 'g');
            if (regex.test(source)) {
                setAdd(newOutput, variableSet);
                replaceInSourceString(fragDataString, newOutput, splitSource);
                splitSource.splice(outputDeclarationLine, 0, 'layout(location = ' + i + ') out vec4 ' + newOutput + ';');
                outputDeclarationLine += 1;
            }
        }

        var czmFragColor = 'czm_fragColor';
        if (findInSource('gl_FragColor', splitSource)) {
            setAdd(czmFragColor, variableSet);
            replaceInSourceString('gl_FragColor', czmFragColor, splitSource);
            splitSource.splice(outputDeclarationLine, 0, 'layout(location = 0) out vec4 czm_fragColor;');
            outputDeclarationLine += 1;
        }

        var variableMap = getVariablePreprocessorBranch(variableSet, splitSource);
        var lineAdds = {};
        for (var c = 0; c < splitSource.length; c++) {
            var l = splitSource[c];
            for (var care in variableMap) {
                if (variableMap.hasOwnProperty(care)) {
                    var matchVar = new RegExp('(layout)[^]+(out)[^]+(' + care + ')[^]+', 'g');
                    if (matchVar.exec(l) !== null) {
                        lineAdds[l] = care;
                    }
                }
            }
        }

        for (var layoutDeclaration in lineAdds) {
            if (lineAdds.hasOwnProperty(layoutDeclaration)) {
                var variableName = lineAdds[layoutDeclaration];
                var lineNumber = splitSource.indexOf(layoutDeclaration);
                var entry = variableMap[variableName];
                var depth = entry.length;
                var d;
                for (d = 0; d < depth; d++) {
                    splitSource.splice(lineNumber, 0, entry[d]);
                }
                lineNumber += depth + 1;
                for (d = depth - 1; d >= 0; d--) {
                    splitSource.splice(lineNumber, 0, '#endif //' + entry[d]);
                }
            }
        }

        var versionThree = '#version 300 es';
        var foundVersion = false;
        for (number = 0; number < splitSource.length; number++) {
            if (/#version/.test(splitSource[number])) {
                splitSource[number] = versionThree;
                foundVersion = true;
            }
        }

        if (!foundVersion) {
            splitSource.splice(0, 0, versionThree);
        }

        removeExtension('EXT_draw_buffers', splitSource);
        removeExtension('EXT_frag_depth', splitSource);

        replaceInSourceString('texture2D', 'texture', splitSource);
        replaceInSourceString('texture3D', 'texture', splitSource);
        replaceInSourceString('textureCube', 'texture', splitSource);
        replaceInSourceString('gl_FragDepthEXT', 'gl_FragDepth', splitSource);

        if (isFragmentShader) {
            replaceInSourceString('varying', 'in', splitSource);
        } else {
            replaceInSourceString('attribute', 'in', splitSource);
            replaceInSourceString('varying', 'out', splitSource);
        }

        return compileSource(splitSource);
    }

    return modernizeShader;
});
