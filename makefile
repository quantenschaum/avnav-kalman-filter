SHELL=/bin/bash

kalman-filter.zip: kalman-filter
	rm -f $@
	zip -r $@ $<

kalman-filter: pyproject.toml $(wildcard plugin.* *.py *.*js *.css *.json *.svg *.md icons/*)
	mkdir -p $@
	cp -rv * $@ || true
	rm -rf $@/__*
	sed -i 's/^__version__.*/__version__ = $(shell grep version $< | cut -d' ' -f3)/' $@/plugin.py

check: check-js check-py

check-js: $(wildcard *.mjs)
	eslint --no-eslintrc --env browser,node,es6 --parser-options '{"sourceType":"module","ecmaVersion":2022}' --rule 'no-undef:error' --rule 'no-unused-vars:warn' --rule 'no-unreachable:error' --rule 'no-dupe-keys:error' --rule 'valid-typeof:error' --rule 'no-redeclare:error' --rule 'no-self-assign:error' --rule 'no-duplicate-case:error' --rule 'no-fallthrough:error' --rule 'no-unsafe-finally:error' --rule 'no-constant-condition:error' $^
	for f in $^; do node --check "$$f" || exit; done
	node --input-type=module -e 'globalThis.window = { location: { search: "" } }; await import("./plugin.mjs");'

check-py: $(wildcard *.py)
	python3 -m py_compile $^
	python3 -m ruff check --ignore E501 $^
	python3 -m flake8 --jobs=1 --ignore=E501,W503 $^
	mypy --ignore-missing-imports $^

test: test-py

test-py:
	python3 -m coverage run --source=kalman -m unittest discover -s test -p 'test_*.py'
	python3 -m coverage report -m
	python3 -m coverage html

clean:
	rm -rf kalman-filter.zip kalman-filter __pycache__
