(define (replace-numbered-patterns str)
      (let ((len (string-length str)))
        (let loop ((i 0) (acc '()))
          (if (>= i len)
              (string-join (reverse acc) "")
              (let ((linebreak-label
                     (and (< (+ i 1) len)
                          (char=? (string-ref str i) #\\)
                          (char=? (string-ref str (+ i 1)) #\\)
                          (parse-numbered-label str (+ i 2))))
                    (hskip-label
                     (or (parse-horizontal-skip-label str i "\\hskip")
                         (parse-horizontal-skip-label str i "\\hspace*")
                         (parse-horizontal-skip-label str i "\\hspace"))))
                (cond
                  (linebreak-label
                   (loop (cdr linebreak-label)
                         (cons (string-append "\\qquad" (car linebreak-label))
                               acc)))
                  (hskip-label
                   (loop (cdr hskip-label)
                         (cons (string-append "\\qquad" (car hskip-label))
                               acc)))
                  (else
                   (loop (+ i 1) (cons (string (string-ref str i)) acc)))))))))
