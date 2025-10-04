import React, { useState, useEffect, useRef } from "react";
import "./MovingCircle.css";

interface MovingCircleProps {
    size: number;
    speed: number;
    color: string;
    /** Ogranicza animację do rozmiaru rodzica (sekcja podglądu) */
    boundToParent?: boolean;
    /** Zmiana tej wartości powoduje restart ruchu od lewej krawędzi */
    resetToken?: number | string;
}

const MovingCircle: React.FC<MovingCircleProps> = ({
                                                       size,
                                                       speed,
                                                       color,
                                                       boundToParent = false,
                                                       resetToken,
                                                   }) => {
    const [positionX, setPositionX] = useState(0);
    const [containerWidth, setContainerWidth] = useState<number>(0);

    const direction = useRef(1);
    const speedRef = useRef(speed);
    const sizeRef = useRef(size);
    const animationRef = useRef<number | null>(null);
    const lastTimeRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Aktualizuj referencje gdy zmieniają się propsy
    useEffect(() => {
        speedRef.current = speed;
        sizeRef.current = size;
    }, [speed, size]);

    // Ustalanie szerokości kontenera (okno lub rodzic)
    useEffect(() => {
        if (boundToParent) {
            const el = containerRef.current;
            if (!el) return;
            const ro = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    setContainerWidth(entry.contentRect.width);
                }
            });
            ro.observe(el);
            setContainerWidth(el.clientWidth);
            return () => ro.disconnect();
        } else {
            const handle = () => setContainerWidth(window.innerWidth);
            handle();
            window.addEventListener("resize", handle);
            return () => window.removeEventListener("resize", handle);
        }
    }, [boundToParent]);

    // Główna pętla animacji
    useEffect(() => {
        const animate = (time: number) => {
            const last = lastTimeRef.current;
            if (last != null) {
                const delta = (time - last) / 1000;
                setPositionX((prev) => {
                    let next = prev + direction.current * speedRef.current * delta;
                    const maxX = Math.max(0, containerWidth - sizeRef.current);
                    if (next < 0) {
                        next = 0;
                        direction.current = 1;
                    } else if (next > maxX) {
                        next = maxX;
                        direction.current = -1;
                    }
                    return next;
                });
            }
            lastTimeRef.current = time;
            animationRef.current = requestAnimationFrame(animate);
        };

        animationRef.current = requestAnimationFrame(animate);
        return () => {
            if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
        };
    }, [containerWidth]);

    // 🔁 Reset pozycji po zmianie resetToken
    useEffect(() => {
        if (resetToken === undefined) return;
        // Start od lewej
        setPositionX(0);
        direction.current = 1;
        // Uniknij "skoku" po restarcie (duży delta)
        lastTimeRef.current = null;
    }, [resetToken]);

    return (
        <div
            ref={containerRef}
            className={boundToParent ? "mc-surface" : "mc-surface mc-surface--fullscreen"}
        >
            <div
                className="mc-circle"
                style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    backgroundColor: color,
                    left: `${positionX}px`,
                }}
            />
        </div>
    );
};

export default MovingCircle;
