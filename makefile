SHELL=/bin/bash

build:
	make -B clean kalman-filter.zip

kalman-filter.zip: kalman-filter
	rm -f $@
	zip -r $@ $<

kalman-filter: pyproject.toml
	mkdir -p $@
	cp * $@ || true
	sed -i 's/^__version__.*/__version__ = $(shell grep version $< | cut -d' ' -f3)/' $@/plugin.py

clean:
	rm -rf kalman-filter.zip kalman-filter __pycache__
