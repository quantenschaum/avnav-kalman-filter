SHELL=/bin/bash

kalman-filter.zip: kalman-filter
	rm -f $@
	zip -r $@ $<

kalman-filter: pyproject.toml $(wildcard plugin.* *.py *.*js *.css *.json *.svg *.md icons/*)
	mkdir -p $@
	cp -rv * $@ || true
	rm -rf $@/__*
	sed -i 's/^__version__.*/__version__ = $(shell grep version $< | cut -d' ' -f3)/' $@/plugin.py

clean:
	rm -rf kalman-filter.zip kalman-filter __pycache__
